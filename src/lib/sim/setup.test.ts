import { describe, expect, it } from "vitest";
import type { Activity } from "@/lib/analysis/rotation";
import type { IndividualSimSettings, RaidSimRequest } from "@/lib/sim/request";
import type { RaidSimResult } from "@/lib/sim/result";
import { describeSetup, type SetupRow } from "@/lib/sim/setup";
import type { WclPlayerFight } from "@/lib/types";

/**
 * The paragraph under a DPS gap that says what produced both numbers.
 *
 * An officer reads a sim comparison to decide whether a raider is playing
 * badly, and every row here is a way that reading can be wrong: a different
 * build, a shorter kill, a pull spent running. So the rows are about states as
 * much as values — `differ` is a row saying "read the gap with this in mind",
 * and a row that quietly says `agree` when the two sides do not is the failure
 * this file is for.
 */

const settings = (over: Partial<IndividualSimSettings> = {}): IndividualSimSettings => ({
  player: {
    talentsString: "5000200110230150331051-05005301",
    rotation: { type: "TypeAPL", priorityList: [{}, {}, {}] },
  },
  encounter: { targets: [{ level: 73, mobType: "MobTypeGiant", stats: statsWithArmor(7700) }] },
  ...over,
});

/** wowsims sends target stats as a bare array indexed by its Stat enum. */
function statsWithArmor(armor: number): number[] {
  const stats = Array.from({ length: 40 }, () => 0);
  stats[31] = armor;
  return stats;
}

const request = (durationSecs = 134): RaidSimRequest => ({
  raid: { parties: [{ players: [] }], numActiveParties: 1 },
  encounter: { duration: durationSecs },
  simOptions: { iterations: 3000, randomSeed: 1 },
});

const result = (over: Partial<RaidSimResult> = {}): RaidSimResult =>
  ({ iterationsDone: 10_000, ...over }) as RaidSimResult;

const pull = (over: Partial<WclPlayerFight> = {}): WclPlayerFight =>
  ({
    id: "r|1|Melige",
    reportCode: "r",
    fightId: 1,
    encounterId: 618,
    encounterName: "Archimonde",
    kill: true,
    durationMs: 134_000,
    actorName: "Melige",
    characterId: null,
    className: "Warrior",
    spec: "Fury",
    role: "dps",
    deaths: 0,
    deathTimes: [],
    elixirs: [],
    lateConsumables: [],
    scrolls: [],
    food: false,
    weaponBuff: false,
    prepot: false,
    potions: [],
    otherCasts: [],
    extras: [],
    cooldowns: [],
    castTimes: [],
    dispels: [],
    interrupts: [],
    upkeep: [],
    gear: [],
    talents: [50, 11, 0],
    drums: 0,
    runes: 0,
    healthstones: 0,
    sappers: 0,
    missingEnchants: [],
    ...over,
  }) as WclPlayerFight;

const activity = (over: Partial<Activity> = {}): Activity => ({
  durationMs: 134_000,
  idleMs: 2_000,
  activePct: 98.5,
  gaps: [],
  ...over,
});

function describe_(over: {
  settings?: IndividualSimSettings;
  request?: RaidSimRequest;
  result?: RaidSimResult;
  pull?: WclPlayerFight;
  activity?: Activity;
} = {}): SetupRow[] {
  return describeSetup({
    settings: over.settings ?? settings(),
    request: over.request ?? request(),
    result: over.result ?? result(),
    pull: over.pull ?? pull(),
    activity: over.activity ?? activity(),
  });
}

const rowFor = (rows: SetupRow[], label: string) => rows.find((r) => r.label === label)!;
const find = (label: string, over?: Parameters<typeof describe_>[0]) =>
  rowFor(describe_(over), label);

describe("the shape of the list", () => {
  it("gives every row a label, a value and a state", () => {
    for (const row of describe_()) {
      expect(row.label, JSON.stringify(row)).toBeTruthy();
      expect(row.value, row.label).toBeTruthy();
      expect(["agree", "differ", "single"]).toContain(row.state);
    }
  });

  it("leads with the boss, which is what the reader is looking for first", () => {
    expect(describe_()[0]).toMatchObject({ label: "Boss", value: "Archimonde" });
  });
});

describe("talents", () => {
  // The false positive this padding was written for: the logs report all three
  // trees and wowsims drops trailing empty ones, so an identical build reads as
  // "21/40" against "21/40/0" and the comparison accuses a raider of playing
  // the wrong spec.
  it("calls an identical build identical, trailing empty tree or not", () => {
    const row = find("Talents", {
      // Two trees in the sim's string, three in the log — same build.
      // (`talentsToTreePoints` sums the digits, so "5555555555" is 50 points.)
      settings: settings({ player: { talentsString: "5555555555-551" } }),
      pull: pull({ talents: [50, 11, 0] }),
    });
    expect(row.state).toBe("agree");
    expect(row.value).toBe("50/11/0");
  });

  it("pads both sides, not just one", () => {
    // Padding the log's side alone would turn "50/11" vs "50/11/0" into a
    // mismatch just as reliably; the width is the max of the two.
    const row = find("Talents", {
      settings: settings({ player: { talentsString: "5555555555-551-0" } }),
      pull: pull({ talents: [50, 11] }),
    });
    expect(row.state).toBe("agree");
  });

  it("says so, with both builds, when they really differ", () => {
    const row = find("Talents", {
      settings: settings({ player: { talentsString: "5555555555-551" } }),
      pull: pull({ talents: [21, 40, 0] }),
    });
    expect(row.state).toBe("differ");
    expect(row.value).toBe("pull 21/40/0");
    expect(row.detail).toBe("sim 50/11/0");
  });

  it("states one side alone when the log never captured a build", () => {
    const row = find("Talents", { pull: pull({ talents: [] }) });
    expect(row.state).toBe("single");
    expect(row.detail).toBe("sim");
  });

  it("says nothing was captured when neither side has a build", () => {
    const row = find("Talents", {
      settings: settings({ player: {} }),
      pull: pull({ talents: [] }),
    });
    expect(row).toMatchObject({ value: "not captured", state: "single", detail: undefined });
  });
});

describe("kill time", () => {
  it("agrees when the sim ran the pull's real length", () => {
    expect(find("Kill time", { request: request(134), pull: pull({ durationMs: 134_000 }) })).toMatchObject({
      value: "134s",
      state: "agree",
    });
  });

  it("puts the pull first when they differ, because that is the fact", () => {
    const row = find("Kill time", { request: request(300), pull: pull({ durationMs: 134_000 }) });
    expect(row.value).toBe("pull 134s");
    expect(row.detail).toBe("sim 300s");
    expect(row.state).toBe("differ");
  });
});

describe("active time", () => {
  it("is a disagreement whenever the raider stopped attacking", () => {
    // The sim never stops, so this row is a comparison against 100% by
    // construction — stating that is the whole point of the row.
    expect(find("Active time", { activity: activity({ activePct: 71.2 }) })).toMatchObject({
      value: "71.2% attacking",
      state: "differ",
    });
  });

  it("stops short of calling a near-perfect pull a problem", () => {
    expect(find("Active time", { activity: activity({ activePct: 95 }) }).state).toBe("agree");
    expect(find("Active time", { activity: activity({ activePct: 94.9 }) }).state).toBe("differ");
  });

  it("says where the idle time went, in seconds", () => {
    expect(find("Active time", { activity: activity({ idleMs: 21_400 }) }).detail).toContain("21s");
  });
});

describe("iterations", () => {
  it("reports what the sim actually did, not what was asked for", () => {
    // A sim that stopped early is a sim whose mean is noisier than requested,
    // and the request is the wrong number to show for it. The two figures have
    // to differ for this to assert anything — the fixture's request asks for
    // 3,000, so the result must not.
    const row = find("Iterations", { result: result({ iterationsDone: 7_500 }) });
    expect(row.value).toBe("7,500 runs");
    expect(request().simOptions.iterations).not.toBe(7_500);
  });

  it("falls back to the request when the result does not say", () => {
    expect(
      find("Iterations", { result: result({ iterationsDone: undefined }), request: request() }).value,
    ).toBe("3,000 runs");
  });
});

describe("rotation", () => {
  it("counts the priorities when there is an APL", () => {
    expect(find("Rotation")).toMatchObject({ value: "APL · 3 priorities", state: "single" });
  });

  it("flags a sim with no APL as a disagreement, because it only auto-attacks", () => {
    const row = find("Rotation", { settings: settings({ player: { talentsString: "1-1" } }) });
    expect(row.state).toBe("differ");
    expect(row.detail).toBe("the sim would only auto-attack");
  });
});

describe("the sim's target", () => {
  it("names the level and the mob type, without the enum prefix", () => {
    expect(find("Sim target").value).toBe("level 73 · Giant");
  });

  it("reports armour, and says plainly when it was never set", () => {
    expect(find("Sim target").detail).toBe("7,700 armour");
    expect(
      find("Sim target", { settings: settings({ encounter: { targets: [{ level: 73 }] } }) }).detail,
    ).toBe("armour not set");
  });

  it("falls back to 'default' rather than an empty string", () => {
    // The row is rendered either way; a blank value reads as a bug.
    expect(find("Sim target", { settings: settings({ encounter: { targets: [] } }) }).value).toBe(
      "default",
    );
    expect(find("Sim target", { settings: settings({ encounter: {} }) }).value).toBe("default");
  });
});

describe("gear", () => {
  it("averages the item level of what was actually worn", () => {
    const row = find("Gear", {
      pull: pull({ gear: [{ ilvl: 120 }, { ilvl: 130 }] as WclPlayerFight["gear"] }),
    });
    expect(row.value).toBe("125 average ilvl");
    expect(row.detail).toBe("2 items, as worn on the pull");
  });

  it("ignores slots the log reported with no item level", () => {
    // Empty slots (a missing ranged weapon, a shirt) come back as 0 and would
    // drag the average down towards nonsense.
    const row = find("Gear", {
      pull: pull({ gear: [{ ilvl: 120 }, { ilvl: 0 }, {}] as WclPlayerFight["gear"] }),
    });
    expect(row.value).toBe("120 average ilvl");
    expect(row.detail).toBe("1 items, as worn on the pull");
  });

  it("says nothing was captured rather than showing a zero", () => {
    expect(find("Gear", { pull: pull({ gear: [] }) })).toMatchObject({
      value: "not captured",
      detail: undefined,
    });
  });
});

describe("deaths", () => {
  it("is a disagreement the moment somebody dies", () => {
    expect(find("Deaths", { pull: pull({ deaths: 2 }) })).toMatchObject({
      value: "2",
      detail: "time dead is time not attacking",
      state: "differ",
    });
  });

  it("agrees, quietly, on a clean pull", () => {
    expect(find("Deaths")).toMatchObject({ value: "0", detail: undefined, state: "agree" });
  });
});

describe("spec as logged", () => {
  it("passes on what Warcraft Logs called it, and says when it said nothing", () => {
    expect(find("Spec as logged").value).toBe("Fury");
    expect(find("Spec as logged", { pull: pull({ spec: undefined }) }).value).toBe("not recorded");
  });
});
