import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Route handlers are not pages, and nothing gates them for us.
 *
 * `pages.test.ts` walks `page.tsx` and fails when one declares no `pageView()`.
 * It says nothing about `route.ts`, which is how `/api/fight-graph` came to
 * serve live Warcraft Logs data — fetched on the deployment's own credentials —
 * to anonymous callers: it began as a server action holding a
 * `requireCapability`, and the move to a route handler for parallelism dropped
 * the check with nothing going red.
 *
 * The same shape as the chrome leak in `docs/pitfalls.md`: gating every page
 * still leaves everything that is not a page wide open.
 */
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /^route\.tsx?$/.test(entry) ? [full] : [];
  });

const root = path.join(process.cwd(), "src", "app");
const rel = (f: string) => path.relative(root, f).split(path.sep).join("/");

/**
 * The sign-in flow, which must answer a request from somebody with no session —
 * that is what it is for. Both routes guard themselves in their own currency:
 * an opaque nonce compared against an httpOnly cookie.
 */
const SIGN_IN_FLOW = ["api/auth/discord/callback/route.ts", "api/auth/discord/start/route.ts"];

const CHECKS = /can\(|requireCapability\(|requireAppAdmin\(|pageView\(/;

/**
 * Comments do not count, and the first version of this test did not know that.
 * Its own header sentence — "`pageView()` gates `page.tsx`" — satisfied the
 * match, so the route passed with the check deleted. That is the failure named
 * in `docs/pitfalls.md`: four of the seven unreachable writers appeared in this
 * codebase *only inside comments describing what they would do*.
 */
const stripComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("every route handler decides who is asking", () => {
  const handlers = walk(root).map(rel).sort();

  it("finds the handlers at all, so an empty walk cannot pass", () => {
    expect(handlers.length).toBeGreaterThan(0);
    expect(handlers).toEqual(expect.arrayContaining(SIGN_IN_FLOW));
  });

  it("has no handler outside the sign-in flow without a capability check", () => {
    const ungated = handlers
      .filter((f) => !SIGN_IN_FLOW.includes(f))
      .filter((f) => !CHECKS.test(stripComments(readFileSync(path.join(root, f), "utf8"))));

    expect(ungated).toEqual([]);
  });

  it("pins the public allowlist, so adding to it is a deliberate act", () => {
    // Widening this list is how a route quietly becomes public. Anything added
    // here needs the same argument the two sign-in routes have.
    expect(SIGN_IN_FLOW).toEqual([
      "api/auth/discord/callback/route.ts",
      "api/auth/discord/start/route.ts",
    ]);
  });
});
