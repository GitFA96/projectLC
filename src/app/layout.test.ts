import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The root layout serves **everybody**, so anything it fetches reaches
 * everybody — including a signed-out stranger on the public profile.
 *
 * That is a hole page gating cannot close. `pageView()` decides what a *page*
 * renders; the chrome around it is computed one level up and is serialized into
 * the response either way. It really happened: the nav's item search was handed
 * the whole demand list in `layout.tsx`, so every anonymous request carried
 * 1458 item names with `wisherCount` and `awardCount` attached — the council's
 * own demand data, which §6 says may never be public — through an app whose
 * pages were all correctly gated.
 *
 * So the layout may only ask for things an outsider is allowed to have.
 */
const source = readFileSync(path.resolve(__dirname, "layout.tsx"), "utf8");

/** Everything an outsider may see is on the public profile. See §6. */
const OUTSIDER_SAFE = ["getGuild"];

describe("the root layout", () => {
  it("fetches nothing an outsider may not have", () => {
    const calls = [...source.matchAll(/repo\.(\w+)\(/g)].map((m) => m[1]);
    const unsafe = calls.filter((name) => !OUTSIDER_SAFE.includes(name));

    expect(
      unsafe,
      "The root layout renders for signed-out visitors too, so whatever it " +
        "fetches is serialized into their response no matter how the pages are " +
        "gated. If this needs to grow, the new call has to be safe for a " +
        "stranger — or it belongs on a page, behind pageView().",
    ).toEqual([]);
  });

  it("passes the guild's identity only to people inside it", () => {
    // The banner says "you are inside this guild". The name itself is public at
    // every preset, but the chrome asserting membership is not.
    expect(source).toContain("inside ?");
  });
});
