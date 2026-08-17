import { describe, expect, it } from "vitest";
import { SECTIONS, activePageFor, sectionFor, under } from "@/components/nav";
import { ROUTE_NEEDS } from "@/lib/auth/view";

/**
 * Which section a path belongs to, and which tab in that section's row lights.
 *
 * Worth testing because the failure is silent in both directions: a path that
 * belongs to no section renders no second row at all (which is how every
 * `/guild/*` page lost its tabs), and a section that claims too much lights the
 * wrong one on a page that looks fine otherwise. Nothing throws either way.
 *
 * Driven by the real `SECTIONS`, deliberately — a fixture would pass while the
 * shipped nav stayed broken.
 */
describe("under", () => {
  it("matches a path at or beneath the base", () => {
    expect(under("/loot", "/loot")).toBe(true);
    expect(under("/loot/plan", "/loot")).toBe(true);
  });

  it("does not match a sibling that merely shares a prefix", () => {
    // Plain startsWith puts this inside /logs.
    expect(under("/logsomething", "/logs")).toBe(false);
    expect(under("/rosterful", "/roster")).toBe(false);
  });

  it("treats the root as exact — it is a prefix of everything", () => {
    expect(under("/", "/")).toBe(true);
    expect(under("/loot", "/")).toBe(false);
  });
});

describe("sectionFor", () => {
  const label = (path: string) => sectionFor(path)?.label;

  it("puts every guild page in the Guild section", () => {
    // The regression: these each resolved to no section, so the sub-nav row
    // rendered nothing and there was no way back to the other guild pages.
    expect(label("/")).toBe("Guild");
    expect(label("/guild/roles")).toBe("Guild");
    expect(label("/guild/preview")).toBe("Guild");
    expect(label("/guild/import")).toBe("Guild");
    expect(label("/guild/audit")).toBe("Guild");
  });

  it("owns /guild paths it does not list", () => {
    expect(label("/guild")).toBe("Guild");
    expect(label("/guild/import/whatever")).toBe("Guild");
  });

  it("does not let the Guild section swallow the rest of the app", () => {
    // Its href is "/", so a prefix match would make everything below Guild's.
    expect(label("/roster")).toBe("Roster");
    expect(label("/loot/plan")).toBe("Loot");
    expect(label("/logs")).toBe("Raids");
    expect(label("/guides")).toBe("Guides");
    expect(label("/service/feedback")).toBe("Service");
  });

  it("resolves pages that don't live under their section's href", () => {
    expect(label("/compare")).toBe("Roster");
    expect(label("/items")).toBe("Loot");
    expect(label("/raid-planner")).toBe("Raids");
  });

  it("keeps a section lit on the detail pages it owns", () => {
    expect(label("/characters/katzewarr/performance")).toBe("Roster");
  });

  it("belongs to nothing outside the guild's own routes", () => {
    expect(sectionFor("/signin")).toBeUndefined();
    expect(sectionFor("/join/abc")).toBeUndefined();
  });
});

describe("activePageFor", () => {
  const guild = SECTIONS.find((s) => s.label === "Guild")!;
  const roster = SECTIONS.find((s) => s.label === "Roster")!;

  it("lights the guild page you are on, not the row's first tab", () => {
    expect(activePageFor("/guild/roles", guild.pages)).toBe("/guild/roles");
    expect(activePageFor("/guild/preview", guild.pages)).toBe("/guild/preview");
    expect(activePageFor("/guild/audit", guild.pages)).toBe("/guild/audit");
  });

  it("lights Guild itself only on the root", () => {
    // "/" prefixes every other href in its own row — the one place a longest
    // match alone would not save us.
    expect(activePageFor("/", guild.pages)).toBe("/");
    expect(activePageFor("/guild/roles", guild.pages)).not.toBe("/");
  });

  it("gives the longest match, so an index doesn't stay lit beneath itself", () => {
    expect(activePageFor("/roster/standing", roster.pages)).toBe("/roster/standing");
    expect(activePageFor("/roster", roster.pages)).toBe("/roster");
  });

  it("lights nothing on a detail page the section merely owns", () => {
    // The section stays lit; no tab claims a page that isn't in the row.
    expect(activePageFor("/characters/katzewarr", roster.pages)).toBeUndefined();
  });

  it("ignores pages hidden from this viewer", () => {
    // `pages` arrives already filtered by capability, so an officer without
    // roles.manage never has /guild/roles lit — or offered.
    const visible = guild.pages!.filter((p) => p.href !== "/guild/roles");
    expect(activePageFor("/guild/roles", visible)).toBeUndefined();
  });
});

describe("the nav and the route gate agree", () => {
  /*
   * `visible()` keeps a link only when whoAmI's `reachable` lists it, and that
   * list is built from ROUTE_NEEDS' keys. A page href missing there is not
   * hidden from some people — it is hidden from everyone, the moment the answer
   * lands. See src/lib/auth/view.ts.
   */
  it("declares what every page in the nav needs", () => {
    const missing = SECTIONS.flatMap((s) => s.pages ?? [{ href: s.href, label: s.label }])
      .map((p) => p.href)
      .filter((href) => !(href in ROUTE_NEEDS));
    expect(missing).toEqual([]);
  });

  it("puts every gated route in a section, so it is reachable by navigation", () => {
    const orphans = Object.keys(ROUTE_NEEDS).filter((href) => sectionFor(href) === undefined);
    expect(orphans).toEqual([]);
  });
});
