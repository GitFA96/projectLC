// @vitest-environment node
import { describe, expect, it } from "vitest";
import { groupPulls, pullId, sectionsOf, type SimPull } from "@/components/performance/sim-panel";
import { TBC_RAIDS, raidOfBoss } from "@/lib/constants/wow";

/** Katzewarr's real Void Reaver spread, plus a second boss on shared nights. */
function pull(over: Partial<SimPull> & { fightId: number }): SimPull {
  return {
    reportCode: "R1",
    actorName: "Katzewarr",
    encounterName: "Void Reaver",
    durationMs: 134_000,
    parsePercent: 96,
    raidDate: "2026-07-22T18:00:00.000Z",
    ...over,
  };
}

const pulls: SimPull[] = [
  pull({ fightId: 77, reportCode: "A", raidDate: "2026-07-22T18:00:00Z", parsePercent: 96, durationMs: 134_000 }),
  pull({ fightId: 64, reportCode: "B", raidDate: "2026-07-15T18:00:00Z", parsePercent: 34, durationMs: 156_000 }),
  pull({ fightId: 47, reportCode: "C", raidDate: "2026-07-29T18:00:00Z", parsePercent: 96, durationMs: 137_000 }),
  pull({ fightId: 25, reportCode: "A", raidDate: "2026-07-22T18:00:00Z", encounterName: "Al'ar", parsePercent: 80 }),
  pull({ fightId: 12, reportCode: "A", raidDate: "2026-07-22T18:00:00Z", encounterName: "Hydross the Unstable", parsePercent: 97 }),
];

describe("groupPulls — by boss", () => {
  const groups = groupPulls(pulls, "boss");

  it("orders bosses by raid progression, then kill order within the raid", () => {
    // SSC before TK, and Hydross (first in SSC) before the TK bosses —
    // alphabetical would put Al'ar first and scatter each instance.
    expect(groups.map((g) => g.key)).toEqual(["Hydross the Unstable", "Al'ar", "Void Reaver"]);
  });

  it("files each boss under its raid instance", () => {
    expect(groups.find((g) => g.key === "Hydross the Unstable")!.section).toBe("Serpentshrine Cavern");
    expect(groups.find((g) => g.key === "Void Reaver")!.section).toBe("Tempest Keep");
  });

  it("puts an unrecognised boss in Other rather than hiding it", () => {
    const odd = groupPulls([pull({ fightId: 1, encounterName: "Some Future Boss" })], "boss");
    expect(odd[0].section).toBe("Other");
    expect(odd[0].pulls).toHaveLength(1);
  });

  it("leaves the night axis unsectioned — a date is already a heading", () => {
    expect(groupPulls(pulls, "night").every((g) => g.section === undefined)).toBe(true);
  });

  it("leads with the best parse — the point of comparing one boss to itself", () => {
    const vr = groups.find((g) => g.key === "Void Reaver")!;
    expect(vr.pulls.map((p) => p.parsePercent)).toEqual([96, 96, 34]);
  });

  it("breaks a parse tie with the more recent night", () => {
    const vr = groups.find((g) => g.key === "Void Reaver")!;
    expect(vr.pulls[0].raidDate.slice(0, 10)).toBe("2026-07-29");
  });

  it("keeps every pull — grouping must never drop one", () => {
    expect(groups.flatMap((g) => g.pulls)).toHaveLength(pulls.length);
  });
});

describe("groupPulls — by raid night", () => {
  const groups = groupPulls(pulls, "night");

  it("makes one group per night, newest first", () => {
    expect(groups.map((g) => g.key.slice(0, 10))).toEqual(["2026-07-29", "2026-07-22", "2026-07-15"]);
  });

  it("keeps a night's pulls in the order they happened", () => {
    const night = groups.find((g) => g.key.startsWith("2026-07-22"))!;
    expect(night.pulls.map((p) => p.fightId)).toEqual([12, 25, 77]);
  });

  it("labels a night as a readable date rather than an ISO string", () => {
    expect(groups[0].label).not.toContain("T");
    expect(groups[0].label).toMatch(/\d/);
  });
});

describe("switching axes keeps the selection", () => {
  it("finds the same pull under either grouping", () => {
    // The behaviour the two-axis picker exists for: the selection is the pull,
    // not the route to it, so flipping the mode must never lose it.
    const target = pulls[1]; // the 34% Void Reaver on 15 Jul
    const id = pullId(target);

    for (const mode of ["boss", "night"] as const) {
      const groups = groupPulls(pulls, mode);
      const owner = groups.find((g) => g.pulls.some((p) => pullId(p) === id));
      expect(owner, `not found when browsing by ${mode}`).toBeDefined();
    }
  });

  it("gives a pull the same id regardless of grouping", () => {
    expect(pullId(pulls[0])).toBe("A:77");
  });

  it("distinguishes the same fight id in different reports", () => {
    // fightId is only unique within a report — the pair has to be the key.
    expect(pullId(pull({ fightId: 1, reportCode: "A" }))).not.toBe(
      pullId(pull({ fightId: 1, reportCode: "B" })),
    );
  });
});

describe("sectionsOf", () => {
  it("collapses consecutive bosses of one raid under a single heading", () => {
    const sections = sectionsOf(groupPulls(pulls, "boss"));
    expect(sections.map((s) => s.section)).toEqual(["Serpentshrine Cavern", "Tempest Keep"]);
    expect(sections[1].groups.map((g) => g.key)).toEqual(["Al'ar", "Void Reaver"]);
  });

  it("emits one unlabelled section when nothing is sectioned", () => {
    const sections = sectionsOf(groupPulls(pulls, "night"));
    expect(sections).toHaveLength(1);
    expect(sections[0].section).toBeUndefined();
  });
});

describe("raidOfBoss", () => {
  it("maps the guild's own encounter names", () => {
    expect(raidOfBoss("Lady Vashj")?.name).toBe("Serpentshrine Cavern");
    expect(raidOfBoss("Gruul the Dragonkiller")?.short).toBe("Gruul");
    expect(raidOfBoss("Kael'thas Sunstrider")?.name).toBe("Tempest Keep");
  });

  it("survives a curly apostrophe — sources disagree on the character", () => {
    expect(raidOfBoss("Kael’thas Sunstrider")?.name).toBe("Tempest Keep");
    expect(raidOfBoss("Al’ar")?.name).toBe("Tempest Keep");
  });

  it("ignores casing", () => {
    expect(raidOfBoss("lady vashj")?.name).toBe("Serpentshrine Cavern");
  });

  it("covers content the guild hasn't reached yet", () => {
    expect(raidOfBoss("Illidan Stormrage")?.short).toBe("BT");
    expect(raidOfBoss("Archimonde")?.short).toBe("MH");
    expect(raidOfBoss("Kil'jaeden")?.short).toBe("SWP");
  });

  it("returns nothing for an unknown boss instead of guessing", () => {
    expect(raidOfBoss("Some Future Boss")).toBeUndefined();
  });

  it("never lists one boss in two raids", () => {
    const seen = new Set<string>();
    for (const raid of TBC_RAIDS) {
      for (const boss of raid.bosses) {
        const key = boss.toLowerCase().replace(/[^a-z0-9]/g, "");
        expect(seen.has(key), `${boss} appears twice`).toBe(false);
        seen.add(key);
      }
    }
  });
});

describe("groupPulls — edge cases", () => {
  it("returns nothing for no pulls", () => {
    expect(groupPulls([], "boss")).toEqual([]);
  });

  it("sorts an unparsed kill below one with a parse", () => {
    const groups = groupPulls(
      [pull({ fightId: 1, parsePercent: undefined }), pull({ fightId: 2, parsePercent: 50 })],
      "boss",
    );
    expect(groups[0].pulls.map((p) => p.fightId)).toEqual([2, 1]);
  });
});
