import { describe, expect, it } from "vitest";
import {
  DEFAULT_RAID_SCOPE,
  OTHER_RAID,
  RAID_SCOPES,
  groupReportsByRaid,
  isGuildScope,
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
