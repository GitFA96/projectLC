import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RaidSimRequest } from "@/lib/sim/request";
import { SimError, decodeSimLink, runSim, simConfigured } from "@/lib/sim/run";

/**
 * The one place this app shells out to somebody else's binary.
 *
 * The wowsims CLI is not vendored — an officer points `WOWSIMCLI_PATH` at their
 * own download — so every failure here is a failure on a machine we have never
 * seen: the path is wrong, the binary is an older build, the sim errored
 * internally. `runSim` promises to turn all of those into a `SimError` whose
 * message says what to do, because the alternative is a stack trace on a page
 * an officer is using to defend a loot decision.
 *
 * The child process is faked at the module boundary rather than injected. Node
 * gives `execFile` a `promisify.custom`, and `run.ts` promisifies it at import,
 * so the fake carries the same symbol — otherwise `promisify` resolves with
 * stdout alone and the module's `{ stdout }` destructuring silently yields
 * undefined. That detail is why the fake looks the way it does.
 */

interface Invocation {
  file: string;
  args: string[];
  options: Record<string, unknown>;
}

const child = vi.hoisted(() => {
  const calls: Invocation[] = [];
  /** What the next call answers with. Replaced per test. */
  let answer: (inv: Invocation) => Promise<{ stdout: string; stderr: string }> = async () => ({
    stdout: "",
    stderr: "",
  });
  const execFile = Object.assign(
    // Nothing calls the callback form; it exists so the shape is honest.
    () => {
      throw new Error("callback form not used");
    },
    {
      [Symbol.for("nodejs.util.promisify.custom")]: (
        file: string,
        args: string[],
        options: Record<string, unknown>,
      ) => {
        const inv = { file, args, options };
        calls.push(inv);
        return answer(inv);
      },
    },
  );
  return {
    execFile,
    calls,
    answers(next: typeof answer) {
      answer = next;
    },
  };
});

vi.mock("node:child_process", () => ({ execFile: child.execFile }));

/** The real fs is used — `runSim` writes a request and reads a result back. */
const { readFile, writeFile } = await import("node:fs/promises");

const BINARY = "/opt/wowsimcli";

const request = (over: Partial<RaidSimRequest> = {}): RaidSimRequest => ({
  raid: { parties: [{ players: [] }], numActiveParties: 1 },
  encounter: { duration: 120 },
  simOptions: { iterations: 3000, randomSeed: 1, ...over.simOptions },
  ...over,
});

/** A CLI that writes the given payload where it was told to. */
function simWrites(payload: unknown) {
  child.answers(async ({ args }) => {
    const outfile = args[args.indexOf("--outfile") + 1];
    await writeFile(outfile, JSON.stringify(payload), "utf8");
    return { stdout: "", stderr: "" };
  });
}

beforeEach(() => {
  child.calls.length = 0;
  vi.stubEnv("WOWSIMCLI_PATH", BINARY);
  // The cache lives on globalThis and outlives a test file otherwise.
  (globalThis as { __projectlcSimCache?: unknown }).__projectlcSimCache = undefined;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("whether a simulator is configured at all", () => {
  it("is configured when the path is set, and not when it is blank", () => {
    expect(simConfigured()).toBe(true);
    vi.stubEnv("WOWSIMCLI_PATH", "   ");
    expect(simConfigured()).toBe(false);
    vi.stubEnv("WOWSIMCLI_PATH", "");
    expect(simConfigured()).toBe(false);
  });

  it.each([
    ["runSim", () => runSim(request())],
    ["decodeSimLink", () => decodeSimLink("https://wowsims.github.io/tbc/#abc")],
  ])("%s says where to get one rather than failing obscurely", async (_label, call) => {
    vi.stubEnv("WOWSIMCLI_PATH", "");
    await expect(call()).rejects.toThrow(SimError);
    await expect(call()).rejects.toThrow(/WOWSIMCLI_PATH/);
    expect(child.calls).toHaveLength(0);
  });
});

describe("reading a share link", () => {
  it("hands the link to the CLI's own decoder and returns the JSON", async () => {
    child.answers(async () => ({ stdout: '{"player":{}}', stderr: "" }));
    const link = "https://wowsims.github.io/tbc/warrior/#eJxLy...";

    expect(await decodeSimLink(link)).toBe('{"player":{}}');
    // The protos are not vendored on purpose: the CLI's decoder is guaranteed
    // to match whatever version the officer downloaded.
    expect(child.calls[0]).toMatchObject({ file: BINARY, args: ["decodelink", link] });
  });

  it("refuses a link with no payload before spending a process on it", async () => {
    await expect(decodeSimLink("https://wowsims.github.io/tbc/warrior/")).rejects.toThrow(
      /Export → Link/,
    );
    expect(child.calls).toHaveLength(0);
  });

  it("reports a CLI that could not read it, with the reason attached", async () => {
    child.answers(async () => {
      throw new Error("exit status 1: unknown link version");
    });
    await expect(decodeSimLink("x#y")).rejects.toThrow(/unknown link version/);
  });

  it("refuses output that is not JSON, which is what an older binary produces", async () => {
    child.answers(async () => ({ stdout: "Usage: wowsimcli [command]", stderr: "" }));
    await expect(decodeSimLink("x#y")).rejects.toThrow(/is it a wowsims TBC link/);
  });
});

describe("running a sim", () => {
  it("passes the request through a file and reads the result back", async () => {
    let seen: unknown;
    child.answers(async ({ args }) => {
      const infile = args[args.indexOf("--infile") + 1];
      seen = JSON.parse(await readFile(infile, "utf8"));
      await writeFile(args[args.indexOf("--outfile") + 1], '{"iterationsDone":3000}', "utf8");
      return { stdout: "", stderr: "" };
    });

    const req = request();
    expect(await runSim(req)).toEqual({ iterationsDone: 3000 });
    expect(seen).toEqual(req);
    expect(child.calls[0].args[0]).toBe("sim");
  });

  it("cleans up its temporary directory, on success and on failure", async () => {
    const dirs: string[] = [];
    child.answers(async ({ args }) => {
      dirs.push(args[args.indexOf("--infile") + 1]);
      await writeFile(args[args.indexOf("--outfile") + 1], "{}", "utf8");
      return { stdout: "", stderr: "" };
    });
    await runSim(request());

    child.answers(async ({ args }) => {
      dirs.push(args[args.indexOf("--infile") + 1]);
      throw new Error("boom");
    });
    await expect(runSim(request({ simOptions: { iterations: 1, randomSeed: 2 } }))).rejects.toThrow(
      SimError,
    );

    // A sim request runs to a few hundred KB and an officer may press the
    // button many times in an afternoon.
    for (const infile of dirs) {
      await expect(readFile(infile, "utf8")).rejects.toThrow();
    }
  });

  it("names the binary when the process itself fails", async () => {
    child.answers(async () => {
      throw new Error("spawn ENOENT");
    });
    // "The simulator failed to run" with no path in it is unactionable when the
    // whole class of cause is a wrong WOWSIMCLI_PATH.
    await expect(runSim(request())).rejects.toThrow(new RegExp(BINARY));
    await expect(runSim(request())).rejects.toThrow(/spawn ENOENT/);
  });

  it("refuses a result file that is missing or unreadable", async () => {
    child.answers(async () => ({ stdout: "", stderr: "" }));
    await expect(runSim(request())).rejects.toThrow(/no readable result/);

    child.answers(async ({ args }) => {
      await writeFile(args[args.indexOf("--outfile") + 1], "not json", "utf8");
      return { stdout: "", stderr: "" };
    });
    await expect(runSim(request({ simOptions: { iterations: 2, randomSeed: 1 } }))).rejects.toThrow(
      /no readable result/,
    );
  });

  it("treats an error inside a zero-exit result as a failure", async () => {
    // The CLI exits 0 on a sim that errored internally and puts the error in
    // the payload, so the exit code is not evidence of anything.
    simWrites({ error: { message: "no rotation configured" } });
    await expect(runSim(request())).rejects.toThrow(/no rotation configured/);
  });

  it("gives the sim two minutes by default, and honours a shorter budget", async () => {
    simWrites({ iterationsDone: 1 });
    await runSim(request());
    expect(child.calls[0].options.timeout).toBe(120_000);

    await runSim(request({ simOptions: { iterations: 9, randomSeed: 1 } }), { timeoutMs: 5_000 });
    expect(child.calls[1].options.timeout).toBe(5_000);
  });

  it("asks for a buffer big enough for a result with a combat log attached", async () => {
    simWrites({ iterationsDone: 1 });
    await runSim(request());
    expect(child.calls[0].options.maxBuffer).toBe(64 * 1024 * 1024);
    // Windows is a first-class target here; the officer runs this on a desktop.
    expect(child.calls[0].options.windowsHide).toBe(true);
  });
});

describe("the cache", () => {
  it("answers an identical request without running anything", async () => {
    simWrites({ iterationsDone: 3000 });
    const first = await runSim(request());
    const second = await runSim(request());

    // Sim runs are pure functions of their request — the seed is in it.
    expect(second).toBe(first);
    expect(child.calls).toHaveLength(1);
  });

  it("runs again for a request that differs anywhere", async () => {
    simWrites({ iterationsDone: 3000 });
    await runSim(request());
    await runSim(request({ simOptions: { iterations: 3000, randomSeed: 2 } }));
    expect(child.calls).toHaveLength(2);
  });

  it("does not cache a failure", async () => {
    child.answers(async () => {
      throw new Error("boom");
    });
    await expect(runSim(request())).rejects.toThrow(SimError);

    simWrites({ iterationsDone: 3000 });
    // A transient failure — the officer's laptop asleep, the binary mid-update
    // — must not poison the request for the rest of the process's life.
    expect(await runSim(request())).toEqual({ iterationsDone: 3000 });
  });

  it("evicts the oldest entry rather than growing without limit", async () => {
    simWrites({ iterationsDone: 1 });
    const nth = (n: number) => request({ simOptions: { iterations: 3000, randomSeed: n } });
    for (let n = 0; n < 61; n++) await runSim(nth(n));
    expect(child.calls).toHaveLength(61);

    // The 61st insert evicted the first, so asking for it again runs.
    await runSim(nth(0));
    expect(child.calls).toHaveLength(62);

    // That re-insert evicted the *second* in turn, which is what a cache with
    // no reordering does: it drops in insertion order, not by how recently
    // anything was used. The third is still there, and answers for free.
    await runSim(nth(2));
    expect(child.calls).toHaveLength(62);
  });
});
