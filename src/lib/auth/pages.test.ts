import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isCapability } from "./capabilities";

/**
 * Every page says what it needs, out loud.
 *
 * This is the deny-by-default half of read gating. The gate itself is one call
 * at the top of each `page.tsx`; what makes it trustworthy is that forgetting
 * the call fails here instead of quietly serving the guild's ledger to anybody
 * who finds the URL. Nothing else catches that — the page compiles, renders and
 * looks right.
 *
 * The same shape as `enforcement.test.ts` for writes, and for the same reason:
 * the dangerous mistake in an authorization layer is always an omission, and an
 * omission is invisible unless something enumerates the whole surface.
 *
 * See docs/change-chains.md §12 and docs/guild-and-player-profiles.md §5–6.
 */

const root = path.resolve(__dirname, "../../..");
const appDir = path.join(root, "src/app");

function pages(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...pages(full));
    else if (entry === "page.tsx") out.push(full);
  }
  return out;
}

const route = (file: string) =>
  `/${path.relative(appDir, path.dirname(file)).split(path.sep).join("/")}`.replace(/^\/\.$|^\/$/, "/");

/** The `pageView("…")` a file declares, or null when it declares nothing. */
function declaredNeed(file: string): string | null {
  const body = readFileSync(file, "utf8");
  const match = body.match(/pageView\(\s*"([^"]+)"/);
  return match ? match[1] : null;
}

describe("every page declares what it needs", () => {
  const all = pages(appDir);

  it("finds the pages at all, so a silent zero can't pass this file", () => {
    expect(all.length).toBeGreaterThan(20);
  });

  it("has no page without a pageView() declaration", () => {
    const undeclared = all.filter((f) => declaredNeed(f) === null).map(route).sort();

    expect(
      undeclared,
      "A page with no pageView() call is ungated: it serves whatever it reads to " +
        "anyone with the URL. Add one at the top — `pageView(\"public\")` is a fine " +
        "answer, but it has to be said rather than assumed.",
    ).toEqual([]);
  });

  it("declares only needs the vocabulary knows", () => {
    // A typo'd capability would otherwise read as "some permission nobody has",
    // which locks the page rather than opening it — safe, but silently wrong.
    const bad = all
      .map((f) => ({ route: route(f), need: declaredNeed(f) }))
      .filter(({ need }) => need !== null && !["public", "member", "app-admin"].includes(need) && !isCapability(need));

    expect(bad).toEqual([]);
  });

  it("keeps the public surface small, and named", () => {
    /*
     * The list that matters most in this file.
     *
     * Everything here is served to anybody with the URL, signed in or not — so
     * adding to it is a decision about what this guild publishes, and it should
     * take a deliberate edit here rather than a default nobody noticed. The
     * guild's own judgements (the ledger, the priority sheet, standing,
     * attendance, comments) may never appear on it. See §6.
     */
    const publicRoutes = all
      .filter((f) => declaredNeed(f) === "public")
      .map(route)
      .sort();

    expect(publicRoutes).toEqual(
      [
        // The guild's front door. It serves two different pages — the dashboard
        // to a member, a separately composed public profile to everyone else —
        // so an outsider is never bounced to a sign-in that would not help them.
        "/",
        "/claim",
        "/join",
        "/signin",
      ].sort(),
    );
  });
});
