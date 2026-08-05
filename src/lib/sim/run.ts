import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { RaidSimRequest } from "@/lib/sim/request";
import type { RaidSimResult } from "@/lib/sim/result";

const run = promisify(execFile);

/**
 * Running the official wowsims CLI as a child process.
 *
 * The binary is NOT vendored. wowsims ships releases almost daily and the
 * binaries are platform-specific, so pinning a copy in this repo would mean
 * owning its staleness and shipping six architectures. Instead the officer
 * points at their own download:
 *
 *     WOWSIMCLI_PATH=C:\...\wowsimcli-windows.exe
 *
 * wowsims is MIT licensed and asks for a user-visible link back to the project;
 * any UI surfacing these results should carry one.
 */

export class SimError extends Error {}

/** Sim runs are pure functions of their request, so identical requests cache. */
const CACHE_MAX = 60;
const globalCache = globalThis as unknown as { __projectlcSimCache?: Map<string, RaidSimResult> };
function cacheOf(): Map<string, RaidSimResult> {
  return (globalCache.__projectlcSimCache ??= new Map());
}

export function simBinaryPath(): string | undefined {
  const p = process.env.WOWSIMCLI_PATH?.trim();
  return p ? p : undefined;
}

export function simConfigured(): boolean {
  return simBinaryPath() !== undefined;
}

/**
 * Turn a wowsims share link into its settings JSON.
 *
 * The payload after the `#` is base64 → zlib → protobuf, so it can't be read
 * without the schema. Rather than vendor the protos and a decoder, we use the
 * CLI's own `decodelink`, which is guaranteed to match whatever version the
 * officer is running.
 *
 * Means an officer pastes the same link they'd share with a raider, instead of
 * being asked to run a command and paste the output.
 */
export async function decodeSimLink(link: string): Promise<string> {
  const binary = simBinaryPath();
  if (!binary) {
    throw new SimError(
      "No simulator configured. Download wowsimcli from github.com/wowsims/tbc-new/releases and set WOWSIMCLI_PATH in .env.local.",
    );
  }
  if (!link.includes("#")) {
    throw new SimError(
      "That doesn't look like a wowsims export link — use Export → Link in wowsims and paste the whole URL, including the part after the #.",
    );
  }
  let stdout: string;
  try {
    ({ stdout } = await run(binary, ["decodelink", link], {
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    }));
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new SimError(`Could not read that link: ${detail}`);
  }
  try {
    JSON.parse(stdout);
  } catch {
    throw new SimError("The link decoded to something unreadable — is it a wowsims TBC link?");
  }
  return stdout;
}

/**
 * Run one simulation. Rejects with SimError for every failure the officer can
 * act on — a missing binary, a broken request, a sim that reported an error —
 * so the UI can say what to do instead of showing a stack trace.
 */
export async function runSim(request: RaidSimRequest, opts: { timeoutMs?: number } = {}): Promise<RaidSimResult> {
  const binary = simBinaryPath();
  if (!binary) {
    throw new SimError(
      "No simulator configured. Download wowsimcli from github.com/wowsims/tbc-new/releases and set WOWSIMCLI_PATH in .env.local.",
    );
  }

  const key = JSON.stringify(request);
  const cache = cacheOf();
  const cached = cache.get(key);
  if (cached) return cached;

  const dir = await mkdtemp(path.join(tmpdir(), "projectlc-sim-"));
  const infile = path.join(dir, "request.json");
  const outfile = path.join(dir, "result.json");
  try {
    await writeFile(infile, JSON.stringify(request), "utf8");
    try {
      await run(binary, ["sim", "--infile", infile, "--outfile", outfile], {
        timeout: opts.timeoutMs ?? 120_000,
        // A sim result runs to a few hundred KB with a combat log attached.
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
      });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      throw new SimError(`The simulator failed to run (${binary}): ${detail}`);
    }

    let parsed: RaidSimResult;
    try {
      parsed = JSON.parse(await readFile(outfile, "utf8")) as RaidSimResult;
    } catch {
      throw new SimError("The simulator produced no readable result.");
    }
    // The CLI exits 0 on a sim that errored internally; the error rides in the
    // payload, so a zero exit code is not evidence of success.
    if (parsed.error) {
      throw new SimError(`The simulator reported an error: ${JSON.stringify(parsed.error)}`);
    }

    if (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, parsed);
    return parsed;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
