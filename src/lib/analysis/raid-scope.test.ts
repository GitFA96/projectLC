import { describe, expect, it } from "vitest";
import {
  DEFAULT_RAID_SCOPE,
  OTHER_RAID,
  RAID_SCOPES,
  filterReportsByRaids,
  groupReportsByRaid,
  isGuildScope,
  keepOfferedRaids,
  parseRaidScope,
  raidScopeLabel,
  raidsOfEncounters,
} from "@/lib/analysis/raid-scope";

describe("parseRaidScope", () => {
  it("accepts the three scopes", () => {
    expect(parseRaidScope("guild")).toBe("guild");
    expect(parseRaidScope("one-off")).toBe("one-off");
    expect(parseRaidScope("pug")).toBe("pug");
  });

  // A meta row edited by hand, or a ?scope= somebody typed, must read as
  // "nothing given" so the caller falls back to the default.
  it("refuses anything else rather than guessing", () => {
    expect(parseRaidScope("Guild")).toBeUndefined();
    expect(parseRaidScope("community")).toBeUndefined();
    expect(parseRaidScope("")).toBeUndefined();
    expect(parseRaidScope(undefined)).toBeUndefined();
    expect(parseRaidScope(null)).toBeUndefined();
    expect(parseRaidScope(3)).toBeUndefined();
    expect(parseRaidScope({ scope: "pug" })).toBeUndefined();
  });
});

describe("the scope vocabulary", () => {
  it("defaults to the guild, and only the guild counts", () => {
    expect(DEFAULT_RAID_SCOPE).toBe("guild");
    expect(isGuildScope("guild")).toBe(true);
    expect(isGuildScope("one-off")).toBe(false);
    expect(isGuildScope("pug")).toBe(false);
  });

  it("offers guild first, and every scope parses back", () => {
    expect(RAID_SCOPES[0].scope).toBe("guild");
    for (const { scope, label, blurb } of RAID_SCOPES) {
      expect(parseRaidScope(scope)).toBe(scope);
      expect(label.length).toBeGreaterThan(0);
      expect(blurb.length).toBeGreaterThan(0);
    }
  });

  it("labels each scope, and falls back to the value it was given", () => {
    expect(raidScopeLabel("guild")).toBe("Guild");
    expect(raidScopeLabel("one-off")).toBe("One-off");
    expect(raidScopeLabel("pug")).toBe("Pug");
  });
});

describe("raidsOfEncounters", () => {
  // Order follows TBC_RAIDS, which lists Black Temple ahead of Mount Hyjal.
  it("names the raid each boss belongs to, in the order TBC_RAIDS lists them", () => {
    expect(raidsOfEncounters(["Archimonde", "Illidan Stormrage", "Lady Vashj"])).toEqual([
      "Serpentshrine Cavern",
      "Black Temple",
      "Mount Hyjal",
    ]);
  });

  it("dedupes a raid pulled several times", () => {
    expect(raidsOfEncounters(["Hydross the Unstable", "Lady Vashj", "Leotheras the Blind"])).toEqual([
      "Serpentshrine Cavern",
    ]);
  });

  // The apostrophe varies between sources; the matcher is deliberately loose.
  it("matches regardless of case and apostrophe", () => {
    expect(raidsOfEncounters(["kael’thas sunstrider"])).toEqual(["Tempest Keep"]);
  });

  it("is empty when nothing matched, rather than inventing a raid", () => {
    expect(raidsOfEncounters(["Some Trash Pack"])).toEqual([]);
    expect(raidsOfEncounters([])).toEqual([]);
  });
});

describe("filterReportsByRaids", () => {
  const nights = [
    { code: "bt", raids: ["Black Temple"] },
    { code: "ssctk", raids: ["Serpentshrine Cavern", "Tempest Keep"] },
    { code: "mystery", raids: [] },
  ];
  const raidsOf = (n: { raids: string[] }) => n.raids;

  // The control exists to narrow a long list; a default that showed nothing
  // would be a filter whose resting state is an empty page.
  it("shows everything when nothing is picked", () => {
    expect(filterReportsByRaids(nights, raidsOf, []).map((n) => n.code)).toEqual([
      "bt",
      "ssctk",
      "mystery",
    ]);
  });

  it("keeps a night that ran any of the picked raids", () => {
    expect(filterReportsByRaids(nights, raidsOf, ["Tempest Keep"]).map((n) => n.code)).toEqual([
      "ssctk",
    ]);
    expect(
      filterReportsByRaids(nights, raidsOf, ["Black Temple", "Tempest Keep"]).map((n) => n.code),
    ).toEqual(["bt", "ssctk"]);
  });

  it("lists an unmatched night only under Other", () => {
    expect(filterReportsByRaids(nights, raidsOf, [OTHER_RAID]).map((n) => n.code)).toEqual([
      "mystery",
    ]);
    expect(filterReportsByRaids(nights, raidsOf, ["Black Temple"]).map((n) => n.code)).not.toContain(
      "mystery",
    );
  });

  it("keeps the order it was given, and copies rather than aliases", () => {
    const all = filterReportsByRaids(nights, raidsOf, []);
    expect(all).not.toBe(nights);
    expect(filterReportsByRaids(nights, raidsOf, ["Karazhan"])).toEqual([]);
  });
});

describe("keepOfferedRaids", () => {
  // Pick Black Temple, switch to the Pug heading, and the pick is still in the
  // query string with nothing to match — which reads as an empty scope.
  it("drops picks nothing on offer can satisfy", () => {
    expect(keepOfferedRaids(["Black Temple", "Karazhan"], ["Karazhan"])).toEqual(["Karazhan"]);
    expect(keepOfferedRaids(["Black Temple"], [])).toEqual([]);
  });

  it("dedupes, and keeps what is offered", () => {
    expect(keepOfferedRaids(["Karazhan", "Karazhan"], ["Karazhan"])).toEqual(["Karazhan"]);
    expect(keepOfferedRaids([], ["Karazhan"])).toEqual([]);
  });
});

describe("groupReportsByRaid", () => {
  const report = (code: string, raids: string[]) => ({ code, raids });

  it("sections nights by raid, in the order TBC_RAIDS lists them", () => {
    const groups = groupReportsByRaid(
      [report("a", ["Mount Hyjal"]), report("b", ["Karazhan"]), report("c", ["Black Temple"])],
      (r) => r.raids,
    );
    expect(groups.map((g) => g.raid)).toEqual(["Karazhan", "Black Temple", "Mount Hyjal"]);
    expect(groups.map((g) => g.short)).toEqual(["Kara", "BT", "MH"]);
  });

  it("keeps the order it was given inside each section", () => {
    const groups = groupReportsByRaid(
      [report("newest", ["Black Temple"]), report("older", ["Black Temple"])],
      (r) => r.raids,
    );
    expect(groups[0].reports.map((r) => r.code)).toEqual(["newest", "older"]);
  });

  // A night that ran two instances is in both, so somebody looking for their
  // Kael'thas kill finds it under Tempest Keep and not only under SSC.
  it("lists a two-instance night under both raids", () => {
    const groups = groupReportsByRaid(
      [report("ssctk", ["Serpentshrine Cavern", "Tempest Keep"])],
      (r) => r.raids,
    );
    expect(groups.map((g) => g.raid)).toEqual(["Serpentshrine Cavern", "Tempest Keep"]);
    expect(groups.every((g) => g.reports[0].code === "ssctk")).toBe(true);
  });

  it("files a night with no recognised boss under Other, last", () => {
    const groups = groupReportsByRaid(
      [report("mystery", []), report("bt", ["Black Temple"])],
      (r) => r.raids,
    );
    expect(groups.map((g) => g.raid)).toEqual(["Black Temple", OTHER_RAID]);
    expect(groups[1].short).toBeUndefined();
  });

  it("has no sections for no reports", () => {
    expect(groupReportsByRaid([], (r: { raids: string[] }) => r.raids)).toEqual([]);
  });
});
