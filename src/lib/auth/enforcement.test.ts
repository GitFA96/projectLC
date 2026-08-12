import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CAPABILITIES, CAPABILITY_IDS, type Capability } from "./capabilities";

/**
 * A capability that gates nothing is a lie told by the permissions UI: it
 * renders as a checkbox, a guild hands out a role on the strength of it, and
 * the app never keeps the promise. Nothing else catches that — the code
 * compiles, the tests pass, and the failure is a guild's trust rather than a
 * stack trace. See docs/change-chains.md §11.
 */

const root = path.resolve(__dirname, "../../..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry) && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/** Every capability named inside a `requireCapability(…)` or `can(…)` call under src/app. */
function enforcedCapabilities(): { found: Set<string>; sites: number } {
  const found = new Set<string>();
  let sites = 0;
  for (const file of walk(path.join(root, "src/app"))) {
    const body = readFileSync(file, "utf8");
    for (const [, name] of body.matchAll(
      /(?:requireCapability|can)\(\s*await resolveViewer\(\)\s*,\s*"([^"]+)"/g,
    )) {
      found.add(name);
      sites += 1;
    }
  }
  return { found, sites };
}

describe("capability enforcement", () => {
  const { found, sites } = enforcedCapabilities();

  it("gates a meaningful number of server actions", () => {
    expect(sites).toBeGreaterThan(40);
  });

  it("never names a capability the vocabulary doesn't have", () => {
    // Catches a typo'd or renamed capability, which would otherwise deny
    // silently and forever — `decide()` denies by default, so the action simply
    // stops working for everyone but the guild master.
    const unknown = [...found].filter((c) => !CAPABILITY_IDS.includes(c as Capability));
    expect(unknown).toEqual([]);
  });

  it("enforces every write capability, except the ones whose feature isn't built", () => {
    const writes = CAPABILITY_IDS.filter((id) => CAPABILITIES[id].kind === "write");
    const unenforced = writes.filter((id) => !found.has(id)).sort();

    /*
     * Empty, and it should stay that way.
     *
     * This used to be an allowlist of capabilities whose feature did not exist
     * yet; `members.manage` came off it with /roster/members and `roles.manage`
     * with /guild/roles, and now **every write capability in the vocabulary has
     * a site that checks it**.
     *
     * So a failure here now means one thing: a capability was added without
     * wiring it up. That is a checkbox in the grant editor which protects
     * nothing, and a guild will make decisions on it. Wire it rather than
     * adding it back to this list.
     */
    expect(unenforced).toEqual([]);
  });

  it("leaves read capabilities to the page layer, which step 1 does not touch", () => {
    // Reads are enforced when getRepo() becomes viewer-scoped (§8). Recording
    // the two that already have action-level sites keeps this honest: it is a
    // statement about today, not a permanent exemption for reads.
    const reads = CAPABILITY_IDS.filter((id) => CAPABILITIES[id].kind === "read");
    expect(reads.filter((id) => found.has(id))).toEqual(["logs.view"]);
  });
});
