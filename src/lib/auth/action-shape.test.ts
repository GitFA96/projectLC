import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every server action decides who is asking, and tells the page to refresh.
 *
 * `enforcement.test.ts` proves each *capability* has at least one site. That is
 * a different claim from this one, and the gap between them is where the bug
 * lives: a vocabulary can be fully enforced while a brand-new action beside a
 * checked one carries no check at all. There are around a hundred exported
 * actions; nobody is going to notice the one that forgot.
 *
 * Two shapes are asserted, and each has already been got wrong here:
 *
 * 1. **A check before the work.** `src/lib/auth/AGENTS.md` records two actions
 *    in `sim/actions.ts` that looked right in review — one whose narrow `try`
 *    reported a denial as "the saved setup is unreadable", one with an
 *    early-return branch that wrote *before* the gate.
 * 2. **A write ends in `refreshAfterWrite()`.** Skip it and the write commits,
 *    the page serves the old value, and nothing anywhere says so.
 *
 * Comments are stripped first. The first version of `routes.test.ts` was
 * satisfied by its own header sentence, and four of the seven unreachable
 * writers in `docs/pitfalls.md` appeared in this codebase *only* inside
 * comments describing what they would do.
 *
 * ## Why this follows calls
 *
 * Looking for a literal `requireCapability` in each action's own body would
 * fail every good pattern this codebase already uses: `service/tenancy` funnels
 * four actions through one `operator()`, `roster/members` gates ownership with
 * `requireOwner()`, `saveLootWeightsAction` delegates wholesale to
 * `savePolicyAction`, and `refetchWclReport` hands off to `importWclReport`.
 * A test that pushed those toward four copies of the check would make the code
 * worse. So a function counts as gated (or refreshing) when it *reaches* one,
 * through any chain of calls among the action files.
 *
 * The reachability is by function **name** across all of `src/app`, so two
 * different files defining the same name would share a verdict. Nothing does
 * today, and the failure direction is leniency in a case somebody would have to
 * construct on purpose — worth knowing, not worth a symbol table.
 */

const appDir = path.resolve(__dirname, "../../app");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /actions\.ts$/.test(entry) && !entry.endsWith(".test.ts") ? [full] : [];
  });
}

const rel = (f: string) => path.relative(appDir, f).split(path.sep).join("/");

const stripComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * What counts as deciding who is asking.
 *
 * `isGuildMaster` is in the list because **ownership is deliberately not a
 * capability** (`src/lib/auth/AGENTS.md`): an officer who could appoint owners
 * could appoint themselves. It is a real gate wearing a different shape, and
 * `requireOwner()` is the only thing standing in front of the ownership writes.
 */
const CHECK = /requireCapability\(|requireAppAdmin\(|\bcan\(\s*await\s+resolveViewer\(\)|isGuildMaster/;
const REFRESH = /refreshAfterWrite\(/;
const WRITES = /getWriteRepo\(/;

interface Fn {
  file: string;
  name: string;
  exported: boolean;
  body: string;
}

/**
 * Every function declared in the action files, with its body.
 *
 * Arrow consts count: `const refreshSim = () => refreshAfterWrite("/sim")` is
 * exactly the kind of one-line helper this has to see through, and reading only
 * `function` declarations made two sim actions look like they never refreshed.
 *
 * Both patterns anchor at column 0, which is what keeps a `const` *inside* a
 * function body from being read as a new top-level declaration and cutting its
 * enclosing function short.
 */
function allFunctions(): Fn[] {
  const out: Fn[] = [];
  const decl = /(?:^|\n)(export\s+)?(?:(?:async\s+)?function\s+(\w+)|const\s+(\w+)\s*=)/g;
  for (const file of walk(appDir)) {
    const source = stripComments(readFileSync(file, "utf8"));
    const starts = [...source.matchAll(decl)];
    starts.forEach((m, i) => {
      const from = m.index + m[0].length;
      const to = i + 1 < starts.length ? starts[i + 1].index : source.length;
      out.push({
        file: rel(file),
        name: m[2] ?? m[3],
        exported: Boolean(m[1]),
        body: source.slice(from, to),
      });
    });
  }
  return out;
}

/**
 * The functions that reach `seed` — directly, or by calling something that does.
 *
 * A plain fixpoint: mark the direct ones, then keep marking anything that calls
 * a marked name until nothing changes.
 */
function reaching(fns: Fn[], seed: RegExp): Set<string> {
  const marked = new Set(fns.filter((f) => seed.test(f.body)).map((f) => f.name));
  for (;;) {
    const before = marked.size;
    for (const f of fns) {
      if (marked.has(f.name)) continue;
      const calls = [...marked].some((name) => new RegExp(`\\b${name}\\s*\\(`).test(f.body));
      if (calls) marked.add(f.name);
    }
    if (marked.size === before) return marked;
  }
}

/**
 * Actions that deliberately check no capability, each with the argument for it.
 *
 * Short on purpose. Every entry is a decision to serve something to whoever
 * asks, so adding one is a decision about what this deployment exposes — never
 * a way to get a build green. Two of these do check *something*; what they do
 * not check is a capability, and in both cases that is the design.
 */
const NO_CAPABILITY_CHECK: Record<string, string> = {
  "account-actions.ts:signOutAction":
    "Ends your own session. A capability here could leave somebody unable to leave.",
  "account-actions.ts:whoAmI":
    "Reports the current viewer to the chrome. Gating 'who am I' on being somebody is circular.",
  "loot-policy-actions.ts:previewPrioritySheetAction":
    "Parses the markdown the caller just typed and reads no guild data. Its sibling " +
    "previewPolicyAction reads the guild's real numbers back and IS gated — that is the line.",
  "loot/actions.ts:lookupItemAction":
    "One item's name, quality and icon by an id the caller already holds. Wowhead-derived " +
    "facts about the game, carrying no wisher, award or council judgement.",
  "service/feedback/actions.ts:submitFeedback":
    "The one write a non-officer can make, open by design — see src/app/AGENTS.md §10.",
  "succession-actions.ts:claimOwnershipAction":
    "Gated on membership and mayClaimOwnership(), deliberately not on a capability: the " +
    "window opens precisely when no owner is around to grant one.",
};

describe("every server action gates itself", () => {
  const fns = allFunctions();
  const actions = fns.filter((f) => f.exported);
  const gated = reaching(fns, CHECK);
  const refreshes = reaching(fns, REFRESH);
  const id = (f: Fn) => `${f.file}:${f.name}`;

  it("finds the actions at all, so an empty walk cannot pass", () => {
    expect(actions.length).toBeGreaterThan(80);
  });

  it("has no action that checks nothing", () => {
    const ungated = actions
      .filter((a) => !NO_CAPABILITY_CHECK[id(a)] && !gated.has(a.name))
      .map(id)
      .sort();

    expect(
      ungated,
      "A server action with no capability check runs for anybody who can reach the " +
        "endpoint — a page gate does not stop a POST. Add the check, or add it to " +
        "NO_CAPABILITY_CHECK with the argument for why this one is open.",
    ).toEqual([]);
  });

  it("keeps the ungated list honest", () => {
    // An entry that stops being needed is a stale claim about the app's public
    // surface, and the next reader believes it. Delete it when it goes.
    const stale = Object.keys(NO_CAPABILITY_CHECK).filter(
      (key) => !actions.some((a) => id(a) === key),
    );
    expect(stale, "NO_CAPABILITY_CHECK names an action that no longer exists").toEqual([]);
  });

  it("refreshes the page after every write", () => {
    const stale = actions
      .filter((a) => WRITES.test(a.body) && !refreshes.has(a.name))
      .map(id)
      .sort();

    expect(
      stale,
      "This action writes and never reaches refreshAfterWrite(), so the officer saves " +
        "and the page keeps serving the old value with nothing to say why. Use the " +
        "helper in @/lib/refresh, never a bare revalidatePath() inside the try — read " +
        "that file's header for the duplicate-award bug that shape causes.",
    ).toEqual([]);
  });
});
