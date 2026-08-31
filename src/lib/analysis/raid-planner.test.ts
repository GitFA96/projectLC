import { describe, expect, it } from "vitest";
import {
  GROUP_COUNT,
  GROUP_SIZE,
  type PoolMember,
  addGroup,
  archetypePalette,
  archetypeSlot,
  benchOf,
  boardFingerprint,
  decodePlan,
  encodePlan,
  clearGroup,
  poolFromPalette,
  removeSlot,
  groupLabel,
  removeGroup,
  setGroupName,
  setSlotLabel,
  slotKey,
  buffsProvidedBy,
  boardView,
  coverageOf,
  dropIntent,
  dropOnSlot,
  emptyBoard,
  moveWithinGroup,
  nudge,
  partiesFromLogs,
  place,
  placeInFirstOpen,
  sanitizeBoard,
  seedBoard,
  setSlotSpec,
  unknownNames,
  withRosterSpecs,
  benchSections,
  rosterBoardKey,
  newGuildRoster,
  nextRosterName,
  poolFromRoster,
  recruitedProspects,
  sanitizeGuildRoster,
  sanitizeProspects,
  selectBoard,
  wclRoleOf,
  withProspects,
  type RosterMember,
} from "@/lib/analysis/raid-planner";
import { BUFF_BY_ID } from "@/lib/constants/raid-buffs";
import type { WclPlayerFight } from "@/lib/types";

/** Slots from bare names — the common shape in these tests. */
const at = (...names: string[]) => names.map((name) => ({ name }));

const member = (name: string, wowClass?: string, spec?: string): PoolMember => ({
  name,
  wowClass,
  spec,
});

const buff = (id: string) => {
  const hit = BUFF_BY_ID.get(id);
  if (!hit) throw new Error(`no such buff: ${id}`);
  return hit;
};

/** A pull row with only the fields this module reads. */
function row(over: Partial<WclPlayerFight> & { actorName: string }): WclPlayerFight {
  return {
    id: `${over.actorName}-1`,
    reportCode: "abc",
    fightId: 1,
    encounterId: 1,
    encounterName: "Hydross the Unstable",
    kill: true,
    durationMs: 200_000,
    characterId: null,
    role: "dps",
    deaths: 0,
    elixirs: [],
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
    drums: 0,
    runes: 0,
    healthstones: 0,
    missingEnchants: [],
    sappers: 0,
    talents: [],
    ...over,
  } as WclPlayerFight;
}

describe("sanitizeBoard", () => {
  it("always produces eight groups, whatever it was given", () => {
    expect(sanitizeBoard(undefined).groups).toHaveLength(GROUP_COUNT);
    expect(sanitizeBoard({ groups: "nonsense" }).groups).toHaveLength(GROUP_COUNT);
    expect(sanitizeBoard({ groups: [["A"], ["B"]] }).groups).toHaveLength(GROUP_COUNT);
  });

  it("caps a group at five and drops blanks and non-strings", () => {
    const comp = sanitizeBoard({ groups: [["A", "B", "", null, "C", "D", "E", "F"]] });
    expect(comp.groups[0]).toEqual(at("A", "B", "C", "D", "E"));
    expect(comp.groups[0]).toHaveLength(GROUP_SIZE);
  });

  it("refuses to put the same raider in two groups", () => {
    // A hand-edited blob (or a bad drag) must not double-count somebody into
    // covering two parties at once.
    const comp = sanitizeBoard({ groups: [["Scomb"], ["scomb", "Byrdx"]] });
    expect(comp.groups[0]).toEqual(at("Scomb"));
    expect(comp.groups[1]).toEqual(at("Byrdx"));
  });
});

describe("moving people", () => {
  const board = () => {
    const comp = emptyBoard();
    comp.groups[0] = at("Katzewarr", "Scomb");
    comp.groups[1] = at("Arë");
    return comp;
  };

  it("seats a benched raider in the first group with room", () => {
    const comp = emptyBoard();
    comp.groups[0] = at("A", "B", "C", "D", "E");
    const next = placeInFirstOpen(comp, "Katzewarr");
    expect(next.groups[0]).toHaveLength(GROUP_SIZE);
    expect(next.groups[1].map((s) => s.name)).toEqual(["Katzewarr"]);
  });

  it("leaves the board alone when every group is full", () => {
    const comp = seedBoard(Array.from({ length: 40 }, (_, i) => ({ name: `R${i}` })));
    expect(placeInFirstOpen(comp, "Latecomer")).toBe(comp);
  });

  it("moves a raider between groups without leaving a copy behind", () => {
    const next = place(board(), "Katzewarr", 1);
    expect(next.groups[0].map((s) => s.name)).toEqual(["Scomb"]);
    expect(next.groups[1].map((s) => s.name)).toEqual(["Arë", "Katzewarr"]);
  });

  it("refuses to overfill a group rather than dropping the raider", () => {
    const comp = emptyBoard();
    comp.groups[0] = at("A", "B", "C", "D", "E");
    comp.groups[1] = at("Katzewarr");
    // The board should reject the drop; losing Katzewarr entirely would be worse.
    expect(place(comp, "Katzewarr", 0)).toBe(comp);
  });

  it("keeps a spec override when the raider changes group", () => {
    const pinned = setSlotSpec(board(), "Katzewarr", "Arms");
    const moved = place(pinned, "Katzewarr", 1);
    expect(moved.groups[1]).toContainEqual({ name: "Katzewarr", spec: "Arms" });
  });

  it("reorders inside a group — position 1 at the top", () => {
    const next = moveWithinGroup(board(), 0, 1, 0);
    expect(next.groups[0].map((s) => s.name)).toEqual(["Scomb", "Katzewarr"]);
  });

  it("ignores a reorder that would fall off either end", () => {
    const comp = board();
    expect(moveWithinGroup(comp, 0, 0, -1)).toBe(comp);
    expect(moveWithinGroup(comp, 0, 1, 2)).toBe(comp);
  });

  it("clears a spec override back to the raider's own spec", () => {
    const pinned = setSlotSpec(board(), "Scomb", "Elemental");
    expect(pinned.groups[0]).toContainEqual({ name: "Scomb", spec: "Elemental" });
    expect(setSlotSpec(pinned, "Scomb", undefined).groups[0]).toContainEqual({ name: "Scomb" });
  });

  it("carries a spec override through a shared link", () => {
    const pinned = setSlotSpec(board(), "Katzewarr", "Arms");
    const shared = decodePlan(encodePlan(pinned))!;
    expect(shared.groups[0].map((s) => [s.name, s.spec])).toEqual(
      pinned.groups[0].map((s) => [s.name, s.spec]),
    );
  });
});

describe("dropping one raider onto another", () => {
  it("inserts above them when the group has room, shuffling everyone down", () => {
    // The behaviour asked for in so many words: drop on position 1 with a free
    // space and 1 becomes 2, 2 becomes 3.
    const comp = emptyBoard();
    comp.groups[0] = at("A", "B", "C");
    comp.groups[1] = at("Mover");

    const next = dropOnSlot(comp, "Mover", 0, 0);
    expect(next.groups[0].map((s) => s.name)).toEqual(["Mover", "A", "B", "C"]);
    expect(next.groups[1]).toEqual([]);
  });

  it("inserts in the middle just as happily", () => {
    const comp = emptyBoard();
    comp.groups[0] = at("A", "B", "C");
    const next = dropOnSlot(comp, "Mover", 0, 1);
    expect(next.groups[0].map((s) => s.name)).toEqual(["A", "Mover", "B", "C"]);
  });

  it("swaps when the group is full — the only way in is for somebody out", () => {
    const comp = emptyBoard();
    comp.groups[0] = at("A", "B", "C", "D", "E");
    comp.groups[1] = at("Mover", "Other");

    const next = dropOnSlot(comp, "Mover", 0, 2);
    expect(next.groups[0].map((s) => s.name)).toEqual(["A", "B", "Mover", "D", "E"]);
    // C takes the mover's old place rather than vanishing.
    expect(next.groups[1].map((s) => s.name)).toEqual(["C", "Other"]);
  });

  it("benches the displaced raider when the mover came off the bench", () => {
    const comp = emptyBoard();
    comp.groups[0] = at("A", "B", "C", "D", "E");
    const next = dropOnSlot(comp, "Benched", 0, 0);
    expect(next.groups[0].map((s) => s.name)).toEqual(["Benched", "B", "C", "D", "E"]);
    expect(next.groups.flat().map((s) => s.name)).not.toContain("A");
  });

  it("reorders by insertion inside one group, never by swapping", () => {
    const comp = emptyBoard();
    comp.groups[0] = at("A", "B", "C", "D", "E");
    // Full group, but moving within it must still slide rather than swap —
    // otherwise dragging up a list reads as a series of pairwise trades.
    const next = dropOnSlot(comp, "E", 0, 0);
    expect(next.groups[0].map((s) => s.name)).toEqual(["E", "A", "B", "C", "D"]);
  });

  it("does nothing when dropped on itself", () => {
    const comp = emptyBoard();
    comp.groups[0] = at("A", "B");
    expect(dropOnSlot(comp, "A", 0, 0)).toBe(comp);
  });

  it("treats a drop on an empty slot as joining the group", () => {
    const comp = emptyBoard();
    comp.groups[0] = at("A");
    const next = dropOnSlot(comp, "Mover", 0, 3);
    expect(next.groups[0].map((s) => s.name)).toEqual(["A", "Mover"]);
  });

  it("keeps a spec override through both behaviours", () => {
    const comp = setSlotSpec(
      { ...emptyBoard(), groups: [at("A", "B", "C", "D", "E"), at("Mover"), [], [], [], [], [], []] },
      "Mover",
      "Arms",
    );
    expect(dropOnSlot(comp, "Mover", 0, 1).groups[0]).toContainEqual({ name: "Mover", spec: "Arms" });

    const roomy = setSlotSpec(
      { ...emptyBoard(), groups: [at("A"), at("Mover"), [], [], [], [], [], []] },
      "Mover",
      "Arms",
    );
    expect(dropOnSlot(roomy, "Mover", 0, 0).groups[0]).toContainEqual({ name: "Mover", spec: "Arms" });
  });

  it("tells the board which behaviour a drop would take, before it happens", () => {
    const comp = emptyBoard();
    comp.groups[0] = at("A", "B", "C", "D", "E");
    comp.groups[1] = at("Roomy", "Mover");

    expect(dropIntent(comp, "Mover", 0, 0)).toBe("swap");
    expect(dropIntent(comp, "Mover", 1, 0)).toBe("insert"); // same group — always a slide
    expect(dropIntent(comp, "A", 1, 0)).toBe("insert"); // group 2 has room
    expect(dropIntent(comp, "A", 0, 0)).toBe("none"); // itself
    expect(dropIntent(comp, "Mover", 2, 0)).toBe("none"); // empty slot
  });
});

describe("planning boards — slot identity, named groups, a stored bench", () => {
  const feral = (id: string) => ({ id, name: "Feral Druid", spec: "Feral" });

  it("keeps identical archetypes apart, where identical people would collapse", () => {
    // A raid wants three Restoration Druids. Two raiders called Scomb is a
    // mistake; two slots called "Feral Druid" is a board.
    const byName = sanitizeBoard({ groups: [[{ name: "Feral Druid" }, { name: "Feral Druid" }]] });
    expect(byName.groups[0]).toHaveLength(1);

    const byId = sanitizeBoard({ groups: [[feral("a"), feral("b"), feral("c")]] });
    expect(byId.groups[0]).toHaveLength(3);
  });

  it("moves one twin without disturbing the others", () => {
    const comp = sanitizeBoard({ groups: [[feral("a"), feral("b")], []] });
    const moved = place(comp, feral("b"), 1);
    expect(moved.groups[0].map(slotKey)).toEqual(["a"]);
    expect(moved.groups[1].map(slotKey)).toEqual(["b"]);
  });

  it("names a group, and hands a blank name back to its number", () => {
    const comp = setGroupName(emptyBoard(3), 0, "  Melee  ");
    expect(groupLabel(comp, 0)).toBe("Melee");
    expect(groupLabel(comp, 1)).toBe("Group 2");
    expect(groupLabel(setGroupName(comp, 0, "  "), 0)).toBe("Group 1");
  });

  it("keeps the space you just typed, so a name can have two words", () => {
    /*
     * This runs on every keystroke of a controlled input. Trimming here means
     * the space is eaten the instant it is pressed and "Melee two" can never be
     * typed at all — the bug this test exists for.
     */
    const typing = setGroupName(emptyBoard(2), 0, "Melee ");
    expect(typing.groupNames?.[0]).toBe("Melee ");
    const finished = setGroupName(typing, 0, "Melee two");
    expect(groupLabel(finished, 0)).toBe("Melee two");
  });

  it("trims a padded name on the way to storage, not while it is being typed", () => {
    const padded = setGroupName(emptyBoard(2), 0, "  Melee  ");
    expect(padded.groupNames?.[0]).toBe("  Melee  ");
    expect(sanitizeBoard(padded, { groups: 2 }).groupNames?.[0]).toBe("Melee");
  });

  it("saves nothing for a name that is only spaces", () => {
    const blank = setGroupName(emptyBoard(2), 0, "   ");
    expect(sanitizeBoard(blank, { groups: 2 }).groupNames).toBeUndefined();
  });

  it("adds and removes groups, within the eight a raid frame has", () => {
    let comp = emptyBoard(2);
    comp = addGroup(comp);
    expect(comp.groups).toHaveLength(3);

    comp = removeGroup(comp, 1);
    expect(comp.groups).toHaveLength(2);

    // Never past eight, and never down to nothing.
    let full = emptyBoard(GROUP_COUNT);
    expect(addGroup(full)).toBe(full);
    const one = emptyBoard(1);
    expect(removeGroup(one, 0)).toBe(one);
    full = emptyBoard(1);
    expect(full.groups).toHaveLength(1);
  });

  it("takes a removed group's occupants with it", () => {
    // On a planner those slots were created and are now gone; "Revert" is the
    // way back, not the bench.
    const comp: ReturnType<typeof emptyBoard> = {
      groups: [[feral("a")], [feral("b")]],
      bench: [],
    };
    const removed = removeGroup(comp, 1);
    expect(removed.groups).toHaveLength(1);
    expect(removed.bench).toEqual([]);
    expect(removed.groups.flat().map(slotKey)).toEqual(["a"]);
  });

  it("hands a raid night's occupants back to the derived bench", () => {
    // Nothing can be destroyed there — the pool comes from the log, so they
    // just stop being placed.
    const comp = emptyBoard(2);
    comp.groups[0] = at("Katzewarr");
    comp.groups[1] = at("Scomb");
    const removed = removeGroup(comp, 1);
    expect(removed.groups.flat().map((s) => s.name)).toEqual(["Katzewarr"]);
    expect(benchOf(removed, [{ name: "Katzewarr" }, { name: "Scomb" }]).map((m) => m.name)).toEqual([
      "Scomb",
    ]);
  });

  it("empties a group without removing it, benching everyone who was in it", () => {
    // The non-destructive half of the pair. On a planner the slots survive on
    // the stored bench — emptying a group must not be a quiet delete.
    const comp = { groups: [[feral("a"), feral("b")], [feral("c")]], bench: [] };
    const cleared = clearGroup(comp, 0);
    expect(cleared.groups).toHaveLength(2);
    expect(cleared.groups[0]).toEqual([]);
    expect(cleared.groups[1].map(slotKey)).toEqual(["c"]);
    expect(cleared.bench?.map(slotKey)).toEqual(["a", "b"]);
  });

  it("keeps a group's name when it is emptied", () => {
    let comp = emptyBoard(2);
    comp.groups[0] = at("Katzewarr");
    comp = setGroupName(comp, 0, "Melee");
    const cleared = clearGroup(comp, 0);
    expect(groupLabel(cleared, 0)).toBe("Melee");
    expect(cleared.groups[0]).toEqual([]);
  });

  it("hands a raid night's emptied group back to the derived bench", () => {
    const comp = emptyBoard(2);
    comp.groups[0] = at("Katzewarr", "Scomb");
    const cleared = clearGroup(comp, 0);
    expect(cleared.bench).toBeUndefined();
    expect(benchOf(cleared, [{ name: "Katzewarr" }, { name: "Scomb" }]).map((m) => m.name)).toEqual([
      "Katzewarr",
      "Scomb",
    ]);
  });

  it("leaves an already empty group and an out-of-range index alone", () => {
    const comp = emptyBoard(2);
    expect(clearGroup(comp, 0)).toBe(comp);
    expect(clearGroup(comp, 9)).toBe(comp);
    expect(clearGroup(comp, -1)).toBe(comp);
  });

  it("keeps a benched slot on a board that stores its bench", () => {
    const comp = { groups: [[feral("a")], []], bench: [] };
    const benched = place(comp, feral("a"), "bench");
    expect(benched.groups[0]).toEqual([]);
    expect(benched.bench?.map(slotKey)).toEqual(["a"]);
    // And back again, without leaving a copy behind.
    const seated = place(benched, feral("a"), 1);
    expect(seated.bench).toEqual([]);
    expect(seated.groups[1].map(slotKey)).toEqual(["a"]);
  });

  it("leaves a raid night's derived bench alone", () => {
    // No stored bench means benching is just "not in a group", exactly as before.
    const comp = emptyBoard();
    comp.groups[0] = at("Scomb");
    const benched = place(comp, "Scomb", "bench");
    expect(benched.bench).toBeUndefined();
    expect(benched.groups.flat()).toEqual([]);
  });

  it("relabels a slot, on the board or on the bench", () => {
    const comp = { groups: [[feral("a")], []], bench: [feral("b")] };
    expect(setSlotLabel(comp, feral("a"), "OT Bear").groups[0][0].label).toBe("OT Bear");
    expect(setSlotLabel(comp, feral("b"), "Spare").bench?.[0].label).toBe("Spare");
    expect(setSlotLabel(setSlotLabel(comp, feral("a"), "OT"), feral("a"), "  ").groups[0][0].label)
      .toBeUndefined();
  });

  it("round-trips groups, names and bench through sanitize", () => {
    const comp = {
      groups: [[feral("a")], [feral("b")]],
      groupNames: ["Melee", undefined],
      bench: [feral("c")],
    };
    const clean = sanitizeBoard(comp, { groups: 2 });
    expect(clean.groups.map((g) => g.map(slotKey))).toEqual([["a"], ["b"]]);
    expect(clean.groupNames?.[0]).toBe("Melee");
    expect(clean.bench?.map(slotKey)).toEqual(["c"]);
  });

  it("still gives a raid night eight groups when nothing says otherwise", () => {
    expect(sanitizeBoard({ groups: [["A"]] }).groups).toHaveLength(GROUP_COUNT);
    expect(sanitizeBoard({ groups: [["A"]] }, { groups: 3 }).groups).toHaveLength(3);
  });
});

describe("the template's palette", () => {
  it("offers every class and spec the game has", () => {
    const palette = archetypePalette();
    expect(palette).toHaveLength(27); // nine classes, three trees each
    expect(palette.some((a) => a.wowClass === "Druid" && a.spec === "Feral")).toBe(true);
    expect(palette.every((a) => a.name === `${a.spec} ${a.wowClass}`)).toBe(true);
  });

  it("folds in the names this guild's own logs use", () => {
    // WCL calls things the talent trees don't — Dreamstate, Guardian — and
    // those are the words an officer actually says.
    const palette = archetypePalette([
      { wowClass: "Druid", spec: "Dreamstate" },
      { wowClass: "Druid", spec: "Guardian" },
    ]);
    expect(palette.some((a) => a.spec === "Dreamstate")).toBe(true);
    expect(palette.some((a) => a.spec === "Guardian")).toBe(true);
  });

  it("leaves out the logged names the guild doesn't plan with", () => {
    // Warcraft Logs labels a pull by what the raider was doing, so the same
    // druid comes back as Feral or Warden and the same paladin as Protection
    // or Justicar. Useful when reading a log; noise next to the spec it
    // duplicates. See NOT_PLANNED_WITH.
    const palette = archetypePalette([
      { wowClass: "Druid", spec: "Warden" },
      { wowClass: "Paladin", spec: "Justicar" },
      { wowClass: "Warrior", spec: "Gladiator" },
    ]);
    for (const dropped of ["Warden", "Justicar", "Gladiator"]) {
      expect(palette.some((a) => a.spec === dropped), dropped).toBe(false);
    }
    // The trees they shadow are still there.
    expect(palette.some((a) => a.wowClass === "Druid" && a.spec === "Feral")).toBe(true);
    expect(palette.some((a) => a.wowClass === "Paladin" && a.spec === "Protection")).toBe(true);
    // A warrior is Arms, Fury and Protection — that's the whole list.
    expect(palette.filter((a) => a.wowClass === "Warrior").map((a) => a.spec)).toEqual([
      "Arms",
      "Fury",
      "Protection",
    ]);
  });

  it("doesn't duplicate a logged spec that's already a talent tree", () => {
    const palette = archetypePalette([
      { wowClass: "Hunter", spec: "BeastMastery" },
      { wowClass: "Druid", spec: "Feral" },
    ]);
    expect(palette.filter((a) => a.wowClass === "Hunter")).toHaveLength(3);
    expect(palette.filter((a) => a.wowClass === "Druid" && a.spec === "Feral")).toHaveLength(1);
  });

  it("ignores a class Warcraft Logs invented", () => {
    expect(archetypePalette([{ wowClass: "Demon Hunter", spec: "Havoc" }])).toHaveLength(27);
  });

  it("resolves every copy of an archetype to the same class and spec", () => {
    // Three "Feral Druid" slots must all count as druids, so coverage sees three.
    const palette = archetypePalette();
    const pool = poolFromPalette(palette);
    const comp: ReturnType<typeof emptyBoard> = {
      groups: [["a", "b", "c"].map((id) => archetypeSlot(palette.find((p) => p.spec === "Feral")!, id))],
    };
    const view = boardView(comp, pool);
    expect(view.groups[0].members.every((m) => m.wowClass === "Druid")).toBe(true);
    expect(view.groups[0].coverage.find((c) => c.buff.id === "leader-of-the-pack")!.providers)
      .toHaveLength(3);
  });

  it("deletes a created slot outright, bench included", () => {
    const feral = archetypeSlot({ wowClass: "Druid", spec: "Feral", name: "Feral Druid" }, "x");
    const comp = { groups: [[feral]], bench: [] };
    expect(removeSlot(comp, feral).groups[0]).toEqual([]);
    expect(removeSlot({ groups: [[]], bench: [feral] }, feral).bench).toEqual([]);
  });
});

describe("encodePlan / decodePlan — the shareable link", () => {
  const plan = () => ({
    groups: [
      [
        { id: "x1", name: "Feral Druid", spec: "Feral", label: "OT Bear" },
        { id: "x2", name: "Fury Warrior", spec: "Fury" },
      ],
      [{ id: "x3", name: "Restoration Shaman", spec: "Restoration" }],
    ],
    groupNames: ["Melee", undefined],
    bench: [{ id: "x4", name: "Holy Priest", spec: "Holy" }],
  });

  it("carries everything a plan is made of", () => {
    // The whole reason this exists rather than reusing encodeBoard: group
    // names, slot labels and the bench all have to survive the trip.
    const back = decodePlan(encodePlan(plan()))!;
    expect(back.groups[0].map((s) => [s.name, s.spec, s.label])).toEqual([
      ["Feral Druid", "Feral", "OT Bear"],
      ["Fury Warrior", "Fury", undefined],
    ]);
    expect(back.groupNames?.[0]).toBe("Melee");
    expect(back.bench?.map((s) => s.name)).toEqual(["Holy Priest"]);
    expect(back.groups).toHaveLength(2);
  });

  it("mints fresh slot ids rather than shipping the sender's", () => {
    // Ids only have to be distinct within one board, so nobody inherits
    // somebody else's keys — but the twins must still be told apart.
    const back = decodePlan(encodePlan(plan()))!;
    const ids = back.groups.flat().map((s) => s.id);
    expect(ids).not.toContain("x1");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps three copies of one archetype as three slots", () => {
    const three = {
      groups: [["a", "b", "c"].map((id) => ({ id, name: "Feral Druid", spec: "Feral" }))],
    };
    expect(decodePlan(encodePlan(three))!.groups[0]).toHaveLength(3);
  });

  it("produces a URL-safe token", () => {
    expect(encodePlan(plan())).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("reads junk as no plan at all, never a thrown page", () => {
    expect(decodePlan(undefined)).toBeUndefined();
    expect(decodePlan("")).toBeUndefined();
    expect(decodePlan("not-base64-at-all!!")).toBeUndefined();
    // A token carrying no groups at all isn't a board.
    expect(decodePlan(btoa(JSON.stringify({ n: ["Melee"] })))).toBeUndefined();
  });

  it("survives a link somebody hand-edited into nonsense", () => {
    const token = encodePlan({ groups: [[{ name: "A" }]] });
    expect(decodePlan(token.slice(0, token.length - 4))).toBeUndefined();
  });
});

describe("boardFingerprint", () => {
  it("changes when a group is renamed", () => {
    // Autosave keys on this. A hash that ignored names would leave an officer
    // renaming a group and watching "Saved" never move.
    const comp = emptyBoard(2);
    expect(boardFingerprint(setGroupName(comp, 0, "Melee"))).not.toBe(
      boardFingerprint(comp),
    );
  });

  it("changes when a slot is relabelled or respecced", () => {
    const comp = { groups: [at("Katzewarr")], bench: undefined };
    expect(boardFingerprint(setSlotLabel(comp, "Katzewarr", "MT"))).not.toBe(
      boardFingerprint(comp),
    );
    expect(boardFingerprint(setSlotSpec(comp, "Katzewarr", "Arms"))).not.toBe(
      boardFingerprint(comp),
    );
  });

  it("changes when the bench changes", () => {
    const comp = { groups: [at("A")], bench: [] };
    expect(boardFingerprint(place(comp, "A", "bench"))).not.toBe(
      boardFingerprint(comp),
    );
  });

  it("is stable for an unchanged board", () => {
    const comp = emptyBoard(3);
    expect(boardFingerprint(comp)).toBe(boardFingerprint(emptyBoard(3)));
  });
});

describe("nudging up and down", () => {
  it("reorders inside the group when there's room to move", () => {
    const comp = emptyBoard();
    comp.groups[0] = at("A", "B", "C");
    expect(nudge(comp, "C", -1).groups[0].map((s) => s.name)).toEqual(["A", "C", "B"]);
    expect(nudge(comp, "A", 1).groups[0].map((s) => s.name)).toEqual(["B", "A", "C"]);
  });

  it("crosses into the group below, landing at the top of it", () => {
    const comp = emptyBoard();
    comp.groups[0] = at("A", "B");
    comp.groups[1] = at("C");
    // Down from the bottom of group 1 is the top of group 2 — that's where it
    // is on the page.
    const next = nudge(comp, "B", 1);
    expect(next.groups[0].map((s) => s.name)).toEqual(["A"]);
    expect(next.groups[1].map((s) => s.name)).toEqual(["B", "C"]);
  });

  it("crosses into the group above, landing at the bottom of it", () => {
    const comp = emptyBoard();
    comp.groups[0] = at("A", "B");
    comp.groups[1] = at("C", "D");
    const next = nudge(comp, "C", -1);
    expect(next.groups[0].map((s) => s.name)).toEqual(["A", "B", "C"]);
    expect(next.groups[1].map((s) => s.name)).toEqual(["D"]);
  });

  it("swaps across the line when the next group is full", () => {
    const comp = emptyBoard();
    comp.groups[0] = at("A", "B", "C", "D", "E");
    comp.groups[1] = at("F", "G", "H", "I", "J");
    // E down: group 2 is full, so E and its top member trade places.
    const down = nudge(comp, "E", 1);
    expect(down.groups[0].map((s) => s.name)).toEqual(["A", "B", "C", "D", "F"]);
    expect(down.groups[1].map((s) => s.name)).toEqual(["E", "G", "H", "I", "J"]);

    // F up: the mirror image, trading with the bottom member of group 1.
    const up = nudge(comp, "F", -1);
    expect(up.groups[0].map((s) => s.name)).toEqual(["A", "B", "C", "D", "F"]);
    expect(up.groups[1].map((s) => s.name)).toEqual(["E", "G", "H", "I", "J"]);
  });

  it("moves into an empty group rather than stopping at the edge", () => {
    const comp = emptyBoard();
    comp.groups[0] = at("A");
    const next = nudge(comp, "A", 1);
    expect(next.groups[0]).toEqual([]);
    expect(next.groups[1].map((s) => s.name)).toEqual(["A"]);
  });

  it("stops at the ends of the board", () => {
    const comp = emptyBoard();
    comp.groups[0] = at("A");
    comp.groups[GROUP_COUNT - 1] = at("Z");
    expect(nudge(comp, "A", -1)).toBe(comp);
    expect(nudge(comp, "Z", 1)).toBe(comp);
  });

  it("does nothing for somebody who isn't on the board", () => {
    const comp = emptyBoard();
    expect(nudge(comp, "Benched", 1)).toBe(comp);
  });

  it("carries a spec override across the line", () => {
    const comp = setSlotSpec(
      { ...emptyBoard(), groups: [at("A"), at("B"), [], [], [], [], [], []] },
      "A",
      "Arms",
    );
    expect(nudge(comp, "A", 1).groups[1]).toContainEqual({ name: "A", spec: "Arms" });
  });
});

describe("spec overrides on the board", () => {
  const pool: PoolMember[] = [
    { name: "Greymatter", wowClass: "Druid", spec: "Restoration", specOptions: ["Restoration", "Feral"] },
  ];

  it("counts a raider as the spec the officer pinned", () => {
    const comp = emptyBoard();
    comp.groups[0] = at("Greymatter");
    // As Restoration he brings no Leader of the Pack.
    expect(
      boardView(comp, pool).groups[0].coverage.find((c) => c.buff.id === "leader-of-the-pack")!
        .state,
    ).toBe("missing");

    const feral = setSlotSpec(comp, "Greymatter", "Feral");
    const view = boardView(feral, pool);
    expect(
      view.groups[0].coverage.find((c) => c.buff.id === "leader-of-the-pack")!.state,
    ).toBe("covered");
    expect(view.groups[0].members[0].specOverridden).toBe(true);
  });

  it("does not mark an override that matches the raider's own spec", () => {
    const comp = setSlotSpec({ ...emptyBoard(), groups: [at("Greymatter"), [], [], [], [], [], [], []] }, "Greymatter", "Restoration");
    expect(boardView(comp, pool).groups[0].members[0].specOverridden).toBe(false);
  });

  it("offers the roster's off-spec alongside what the log saw", () => {
    const fromLog: PoolMember[] = [
      { name: "Aizaizbaby", wowClass: "Priest", spec: "Shadow", specOptions: ["Shadow"] },
      { name: "Pugger", wowClass: "Mage", spec: "Fire", specOptions: ["Fire"] },
    ];
    const merged = withRosterSpecs(fromLog, [
      { name: "Aizaizbaby", spec: "Shadow", offSpec: "Holy" },
    ]);
    // The log's answer leads — it is the one backed by evidence.
    expect(merged[0].specOptions).toEqual(["Shadow", "Holy"]);
    // A pugger keeps only what the log saw; the roster knows nothing about them.
    expect(merged[1].specOptions).toEqual(["Fire"]);
  });
});

describe("coverageOf", () => {
  it("covers a buff when a class that always brings it is present", () => {
    const cover = coverageOf(buff("battle-shout"), [member("Katzewarr", "Warrior", "Fury")]);
    expect(cover.state).toBe("covered");
    expect(cover.providers.map((p) => p.name)).toEqual(["Katzewarr"]);
  });

  it("is missing when nobody of the class is there", () => {
    expect(coverageOf(buff("battle-shout"), [member("Aizaizbaby", "Priest", "Shadow")]).state).toBe(
      "missing",
    );
  });

  it("reads a spec-gated buff as conditional when the spec was never logged", () => {
    // The whole point of the third state: a druid with no recorded spec may
    // well be Feral. Calling it covered invents the aura; calling it missing
    // sends an officer to move somebody who was already fine.
    const cover = coverageOf(buff("leader-of-the-pack"), [member("Greymatter", "Druid")]);
    expect(cover.state).toBe("conditional");
    expect(cover.possible.map((p) => p.name)).toEqual(["Greymatter"]);
    expect(cover.providers).toEqual([]);
  });

  it("covers a spec-gated buff once the spec matches, whatever the spacing", () => {
    // WCL writes "BeastMastery"; a roster form writes "Beast Mastery".
    expect(coverageOf(buff("ferocious-inspiration"), [member("Byrdx", "Hunter", "BeastMastery")]).state)
      .toBe("covered");
    expect(coverageOf(buff("ferocious-inspiration"), [member("Byrdx", "Hunter", "Beast Mastery")]).state)
      .toBe("covered");
  });

  it("is missing when the class is right and the logged spec is wrong", () => {
    expect(coverageOf(buff("moonkin-aura"), [member("Greymatter", "Druid", "Restoration")]).state).toBe(
      "missing",
    );
  });

  it("counts a buff no class predicts when the log caught someone providing it", () => {
    // Nobody's class implies a jewelcrafting neck. The log saw one anyway.
    const cover = coverageOf(buff("party-neck"), [
      { name: "Scomb", wowClass: "Warrior", broughtBuffs: ["party-neck"] },
    ]);
    expect(cover.state).toBe("covered");
    expect(cover.evidenced.map((m) => m.name)).toEqual(["Scomb"]);
  });

  it("promotes conditional to covered once the log proves the talent", () => {
    // A druid with no recorded spec who kept Innervate up is demonstrably a
    // druid who brings Innervate, whatever the roster forgot to say.
    const unknownSpec = coverageOf(buff("power-infusion"), [member("Aizaizbaby", "Priest")]);
    expect(unknownSpec.state).toBe("conditional");

    const proven = coverageOf(buff("power-infusion"), [
      { name: "Aizaizbaby", wowClass: "Priest", broughtBuffs: ["power-infusion"] },
    ]);
    expect(proven.state).toBe("covered");
  });

  it("refuses to turn one shaman into every totem", () => {
    // A shaman drops one totem per element. Counting all four air totems from
    // one shaman is the easiest way for a board tool to flatter a raid,
    // so a class prediction alone can never cover an exclusive buff.
    const shaman = [member("Arë", "Shaman", "Enhancement")];
    for (const id of ["windfury-totem", "grace-of-air-totem", "wrath-of-air-totem"]) {
      expect(coverageOf(buff(id), shaman).state, id).toBe("conditional");
    }
    // Battle Shout has no such choice behind it — one warrior really is one shout.
    expect(coverageOf(buff("battle-shout"), [member("Katzewarr", "Warrior")]).state).toBe("covered");
  });

  it("offers Sanctity Aura to any paladin, not just a retribution one", () => {
    /*
     * The talent sits in Retribution, but a Holy paladin who spends the points
     * brings the aura just as well — a real choice this guild makes. Gating it
     * on spec would report that paladin as missing, which is a wrong answer
     * rather than an unconfirmed one.
     */
    for (const spec of ["Retribution", "Holy", undefined]) {
      const cover = coverageOf(buff("sanctity-aura"), [member("Kaldén", "Paladin", spec)]);
      expect(cover.state, spec ?? "no spec").toBe("conditional");
      expect(cover.possible.map((p) => p.name)).toEqual(["Kaldén"]);
    }
  });

  it("never claims a paladin is running two auras at once", () => {
    // One paladin is one aura. Predicting all three from one body is exactly
    // the flattering-direction error `exclusiveWith` exists to stop.
    const paladin = [member("Kaldén", "Paladin", "Retribution")];
    for (const id of ["sanctity-aura", "devotion-aura", "concentration-aura"]) {
      expect(coverageOf(buff(id), paladin).state, id).toBe("conditional");
    }
  });

  it("has no Sanctity Aura without a paladin", () => {
    expect(coverageOf(buff("sanctity-aura"), [member("Katzewarr", "Warrior", "Fury")]).state).toBe(
      "missing",
    );
  });

  it("covers the totem the log shows him actually dropping", () => {
    const arë: PoolMember = {
      name: "Arë",
      wowClass: "Shaman",
      spec: "Enhancement",
      broughtBuffs: ["windfury-totem", "grace-of-air-totem"],
    };
    expect(coverageOf(buff("windfury-totem"), [arë]).state).toBe("covered");
    // Same element, not dropped — still only a possibility.
    expect(coverageOf(buff("wrath-of-air-totem"), [arë]).state).toBe("conditional");
  });

  it("does not let a silent log downgrade a raider who can bring it", () => {
    // Evidence only ever adds. A warrior who wasn't caught shouting on the
    // pulls we have still means the group has a Battle Shout.
    const cover = coverageOf(buff("battle-shout"), [
      { name: "Katzewarr", wowClass: "Warrior", broughtBuffs: [] },
    ]);
    expect(cover.state).toBe("covered");
    expect(cover.evidenced).toEqual([]);
  });
});

describe("boardView", () => {
  const pool: PoolMember[] = [
    { name: "Katzewarr", wowClass: "Warrior", spec: "Fury", role: "dps" },
    { name: "Scomb", wowClass: "Shaman", spec: "Enhancement", role: "dps" },
    { name: "Aizaizbaby", wowClass: "Priest", spec: "Shadow", role: "dps" },
    { name: "Greymatter", wowClass: "Druid", spec: "Restoration", role: "healer" },
    { name: "Byrdx", wowClass: "Paladin", spec: "Protection", role: "tank" },
  ];

  it("scores party buffs per group, not raid-wide", () => {
    const comp = emptyBoard();
    comp.groups[0] = at("Katzewarr", "Scomb");
    comp.groups[1] = at("Aizaizbaby");
    const view = boardView(comp, pool);

    const shoutIn = (g: number) =>
      view.groups[g].coverage.find((c) => c.buff.id === "battle-shout")!.state;
    expect(shoutIn(0)).toBe("covered");
    // The warrior is in group 1 — group 2 gets nothing from him.
    expect(shoutIn(1)).toBe("missing");
  });

  it("scores raid and boss buffs across everyone assigned", () => {
    const comp = emptyBoard();
    comp.groups[0] = at("Katzewarr");
    comp.groups[3] = at("Aizaizbaby");
    const view = boardView(comp, pool);

    const state = (id: string) => view.raid.find((c) => c.buff.id === id)!.state;
    expect(state("sunder-armor")).toBe("covered"); // warrior, group 1
    expect(state("misery")).toBe("covered"); // shadow priest, group 4
    expect(state("winters-chill")).toBe("missing"); // no mage anywhere
  });

  it("counts roles and classes over assigned raiders only", () => {
    const comp = emptyBoard();
    comp.groups[0] = at("Byrdx", "Greymatter");
    const view = boardView(comp, pool);
    expect(view.roles).toEqual({ tank: 1, healer: 1, dps: 0 });
    expect(view.assigned).toBe(2);
    expect(view.bench.map((m) => m.name)).toEqual(["Katzewarr", "Scomb", "Aizaizbaby"]);
  });

  it("keeps a name the pool no longer knows instead of quietly dropping it", () => {
    const comp = emptyBoard();
    comp.groups[0] = at("Katzewarr", "Someonewholeft");
    const view = boardView(comp, pool);
    expect(view.groups[0].members.map((m) => m.name)).toEqual(["Katzewarr", "Someonewholeft"]);
    expect(view.unknown).toEqual(["Someonewholeft"]);
    expect(unknownNames(comp, pool)).toEqual(["Someonewholeft"]);
  });

  it("benches everyone when nothing is assigned", () => {
    expect(benchOf(emptyBoard(), pool)).toHaveLength(pool.length);
  });
});

describe("partiesFromLogs", () => {
  /*
   * Shaped on a real observation from this guild's 5 Aug SSC report: Greymatter's
   * Braided Eternium Chain reached exactly four other players, which is a party.
   */
  const neckRow = (pulls: number) =>
    Array.from({ length: pulls }, (_, i) =>
      row({
        actorName: "Greymatter",
        fightId: i + 1,
        upkeep: [
          {
            name: "Braided Eternium Chain",
            pct: 100,
            targets: ["Greymatter", "Scomb", "Byrdx", "Aizaizbaby", "Arë"].map((target) => ({ target, boss: false, player: true, pct: 100, segments: [] })),
          },
        ],
      }),
    );

  it("recovers the wearer's party from a logged party buff", () => {
    const [party] = partiesFromLogs(neckRow(1));
    expect(party.wearer).toBe("Greymatter");
    expect(party.buff).toBe("Braided Eternium Chain");
    expect(party.members).toEqual(["Greymatter", "Scomb", "Byrdx", "Aizaizbaby", "Arë"]);
  });

  it("counts the pulls the same grouping held for", () => {
    expect(partiesFromLogs(neckRow(3))[0].pulls).toBe(3);
  });

  it("recovers a party from Battle Shout too, short recipient list and all", () => {
    // Real shape from the 5 Aug SSC report: Katzewarr's shout reached three
    // others on that pull. A party of four is a floor, not a contradiction.
    const shout = row({
      actorName: "Katzewarr",
      upkeep: [
        {
          name: "Battle Shout",
          pct: 96,
          targets: ["Arë", "Greymatter", "Katzewarr", "Wtfabear"].map((target) => ({
            target,
            boss: false,
            player: true,
            pct: 96,
            segments: [],
          })),
        },
      ],
    });
    const [party] = partiesFromLogs([shout]);
    expect(party.members).toEqual(["Katzewarr", "Arë", "Greymatter", "Wtfabear"]);
  });

  it("drops an observation of one, which says nothing about a group", () => {
    // Rampage sits on the warrior himself. "He was in range of himself" is not
    // a party.
    const selfOnly = row({
      actorName: "Katzewarr",
      upkeep: [
        {
          name: "Rampage",
          pct: 88,
          targets: [{ target: "Katzewarr", boss: false, player: true, pct: 88, segments: [] }],
        },
      ],
    });
    expect(partiesFromLogs([selfOnly])).toEqual([]);
  });

  it("says nothing when the buff reached more than a party", () => {
    // Six recipients means it isn't party-scoped after all (or the log is
    // confused). A group that can't exist is worse than no suggestion.
    const wide = row({
      actorName: "Greymatter",
      upkeep: [
        {
          name: "Braided Eternium Chain",
          pct: 100,
          targets: ["A", "B", "C", "D", "E", "F"].map((target) => ({ target, boss: false, player: true, pct: 100, segments: [] })),
        },
      ],
    });
    expect(partiesFromLogs([wide])).toEqual([]);
  });

  it("ignores tracks that aren't party buffs", () => {
    const shout = row({
      actorName: "Katzewarr",
      upkeep: [
        {
          name: "Sunder Armor",
          pct: 98,
          targets: [{ target: "Hydross the Unstable", boss: true, pct: 98, segments: [] }],
        },
      ],
    });
    expect(partiesFromLogs([shout])).toEqual([]);
  });
});

describe("seedBoard", () => {
  const pool: PoolMember[] = ["Greymatter", "Scomb", "Byrdx", "Aizaizbaby", "Arë", "Katzewarr"].map(
    (name) => ({ name }),
  );

  it("puts a recovered party in group 1 and fills the rest around it", () => {
    const comp = seedBoard(pool, [
      { wearer: "Greymatter", buff: "Braided Eternium Chain", members: ["Greymatter", "Scomb", "Byrdx", "Aizaizbaby", "Arë"], pulls: 4 },
    ]);
    expect(comp.groups[0]).toEqual(at("Greymatter", "Scomb", "Byrdx", "Aizaizbaby", "Arë"));
    expect(comp.groups[1]).toEqual(at("Katzewarr"));
  });

  it("skips a recovered party that overlaps one already placed", () => {
    // Two necks can disagree about who Scomb stood with. The first placement
    // wins and the second is dropped whole — never split, and never duplicated
    // into two groups, which would have him covering both parties at once.
    const comp = seedBoard(pool, [
      { wearer: "Greymatter", buff: "Braided Eternium Chain", members: ["Greymatter", "Scomb"], pulls: 4 },
      { wearer: "Byrdx", buff: "Eye of the Night", members: ["Byrdx", "Scomb"], pulls: 2 },
    ]);
    expect(comp.groups[0].slice(0, 2)).toEqual(at("Greymatter", "Scomb"));
    const placed = comp.groups.flat().map((s) => s.name);
    expect(placed.filter((n) => n === "Scomb")).toHaveLength(1);
    expect(new Set(placed).size).toBe(placed.length);
  });

  it("ignores recovered names the pool doesn't have", () => {
    const comp = seedBoard([{ name: "Scomb" }], [
      { wearer: "Ghost", buff: "Eye of the Night", members: ["Ghost"], pulls: 1 },
    ]);
    expect(comp.groups.flat().map((s) => s.name)).toEqual(["Scomb"]);
  });

  it("places nobody twice and stops when the board is full", () => {
    const big = Array.from({ length: 50 }, (_, i) => ({ name: `R${i}` }));
    const comp = seedBoard(big);
    const placed = comp.groups.flat().map((s) => s.name);
    expect(placed).toHaveLength(GROUP_COUNT * GROUP_SIZE);
    expect(new Set(placed).size).toBe(placed.length);
  });
});

describe("buffsProvidedBy", () => {
  it("reports a buff the raider's own upkeep carries", () => {
    const ids = buffsProvidedBy([
      row({ actorName: "Katzewarr", upkeep: [{ name: "Battle Shout", pct: 92 }] }),
    ]);
    expect(ids).toContain("battle-shout");
  });

  it("reports a cooldown they pressed", () => {
    expect(buffsProvidedBy([row({ actorName: "Scomb", cooldowns: ["Bloodlust"] })])).toContain(
      "bloodlust",
    );
  });

  it("reports a totem drop from the cast timeline", () => {
    const ids = buffsProvidedBy([
      row({
        actorName: "Scomb",
        castTimes: [{ name: "Windfury Totem", atMs: 1200, totem: true }],
      }),
    ]);
    expect(ids).toContain("windfury-totem");
  });

  it("treats any of the three jewelcrafting necks as the same party buff", () => {
    const ids = buffsProvidedBy([
      row({ actorName: "Byrdx", upkeep: [{ name: "Eye of the Night", pct: 100 }] }),
    ]);
    expect(ids).toContain("party-neck");
  });

  it("stays silent about buffs a TBC log never emits", () => {
    // Blessings have no loggedAs — their absence here is by design, and must
    // never read as "the raid didn't have Kings".
    const ids = buffsProvidedBy([
      row({ actorName: "Byrdx", upkeep: [{ name: "Battle Shout", pct: 90 }] }),
    ]);
    expect(ids).not.toContain("blessing-of-kings");
  });
});

/* ------------------------------------------------------ the guild's boards */

const rosterMember = (over: Partial<RosterMember> & { name: string }): RosterMember => ({
  wowClass: "Warrior",
  spec: "Fury",
  role: "Melee DPS",
  status: "main",
  ...over,
});

describe("wclRoleOf", () => {
  it("collapses the roster's two dps roles into the log's one", () => {
    expect(wclRoleOf("Melee DPS")).toBe("dps");
    expect(wclRoleOf("Ranged DPS")).toBe("dps");
  });

  it("keeps tank and healer", () => {
    expect(wclRoleOf("Tank")).toBe("tank");
    expect(wclRoleOf("Healer")).toBe("healer");
  });

  it("leaves anything it doesn't recognise undefined rather than guessing dps", () => {
    expect(wclRoleOf("Bench")).toBeUndefined();
    expect(wclRoleOf(undefined)).toBeUndefined();
  });
});

describe("poolFromRoster", () => {
  it("keeps mains and alts, drops pugs and the inactive", () => {
    const pool = poolFromRoster([
      rosterMember({ name: "Katzewarr", status: "main" }),
      rosterMember({ name: "Katzealt", status: "alt" }),
      rosterMember({ name: "Somepug", status: "pug" }),
      rosterMember({ name: "Leftguild", status: "inactive" }),
    ]);
    expect(pool.map((m) => m.name)).toEqual(["Katzewarr", "Katzealt"]);
  });

  it("puts mains before alts, and groups each by class", () => {
    const pool = poolFromRoster([
      rosterMember({ name: "Mainwar", wowClass: "Warrior", status: "main" }),
      rosterMember({ name: "Altdruid", wowClass: "Druid", status: "alt" }),
      rosterMember({ name: "Mainhunt", wowClass: "Hunter", status: "main" }),
      rosterMember({ name: "Mainwar2", wowClass: "Warrior", status: "main" }),
      rosterMember({ name: "Altwar", wowClass: "Warrior", status: "alt" }),
    ]);
    expect(pool.map((m) => m.name)).toEqual([
      // Mains, by class in WOW_CLASSES order: Hunter before Warrior.
      "Mainhunt",
      "Mainwar",
      "Mainwar2",
      // Then alts, same rule.
      "Altdruid",
      "Altwar",
    ]);
  });

  it("keeps a class with no name we know last rather than first", () => {
    const pool = poolFromRoster([
      rosterMember({ name: "Mystery", wowClass: undefined }),
      rosterMember({ name: "Zulwar", wowClass: "Warrior" }),
    ]);
    expect(pool.map((m) => m.name)).toEqual(["Zulwar", "Mystery"]);
  });

  it("records the roster status, which is what the bench splits on", () => {
    const pool = poolFromRoster([
      rosterMember({ name: "Amain", status: "main" }),
      rosterMember({ name: "Analt", status: "alt" }),
    ]);
    expect(pool.map((m) => m.rosterStatus)).toEqual(["main", "alt"]);
  });

  it("offers the off-spec as a second option, and no options at all with one spec", () => {
    // By name, not by position. The order itself is now stable everywhere
    // (`compareText`, src/lib/sort.ts), but a test that indexed into a sorted
    // array would still break the day the sort key changes, which is a worse
    // failure than it looks: it reports a comparator change as a spec bug.
    const pool = poolFromRoster([
      rosterMember({ name: "Duospec", spec: "Fury", offSpec: "Protection" }),
      rosterMember({ name: "Monospec", spec: "Fury", offSpec: undefined }),
    ]);
    expect(pool.find((m) => m.name === "Duospec")?.specOptions).toEqual(["Fury", "Protection"]);
    expect(pool.find((m) => m.name === "Monospec")?.specOptions).toBeUndefined();
  });

  it("carries the slug, so a chip can link to the character", () => {
    expect(poolFromRoster([rosterMember({ name: "Katzewarr" })])[0].slug).toBe("katzewarr");
  });
});

describe("withProspects", () => {
  it("adds an invented raider and marks them as one", () => {
    const pool = withProspects(poolFromRoster([rosterMember({ name: "Katzewarr" })]), [
      { name: "Newshaman", wowClass: "Shaman", spec: "Restoration", role: "healer" },
    ]);
    expect(pool.map((m) => m.name)).toEqual(["Katzewarr", "Newshaman"]);
    expect(pool[1].prospect).toBe(true);
    expect(pool[0].prospect).toBeUndefined();
  });

  it("drops a prospect the roster has since acquired rather than duplicating the name", () => {
    // Two chips with one name would break slotKey, which identifies a person by it.
    const pool = withProspects(poolFromRoster([rosterMember({ name: "Newshaman" })]), [
      { name: "newshaman" },
    ]);
    expect(pool).toHaveLength(1);
    expect(pool[0].prospect).toBeUndefined();
  });

  it("counts an invented raider towards their group's buffs like anyone else", () => {
    // The whole point of a trial: seeing what the group would gain by having one.
    const pool = withProspects([], [{ name: "Trialsham", wowClass: "Shaman", spec: "Restoration" }]);
    const view = boardView({ groups: [at("Trialsham"), [], [], [], [], [], [], []] }, pool);
    const lust = view.groups[0].coverage.find((c) => c.buff.id === "bloodlust");
    expect(lust?.state).toBe("covered");
    expect(view.groups[1].coverage.find((c) => c.buff.id === "bloodlust")?.state).toBe("missing");
  });
});

describe("benchSections", () => {
  /** The bench as `boardView` hands it over: pool members, nobody placed. */
  const benchOfPool = (pool: PoolMember[]) =>
    boardView({ groups: [[], [], [], [], [], [], [], []] }, pool).bench;

  it("splits a guild bench into mains, alts and trials, in that order", () => {
    const pool = withProspects(
      poolFromRoster([
        rosterMember({ name: "Amain", status: "main" }),
        rosterMember({ name: "Analt", status: "alt" }),
      ]),
      [{ name: "Atrial", wowClass: "Warrior" }],
    );
    const sections = benchSections(benchOfPool(pool));
    expect(sections.map((s) => [s.label, s.members.map((m) => m.name)])).toEqual([
      ["Mains", ["Amain"]],
      ["Alts", ["Analt"]],
      ["Trials", ["Atrial"]],
    ]);
  });

  it("leaves out a section nobody is in", () => {
    const pool = poolFromRoster([rosterMember({ name: "Amain", status: "main" })]);
    expect(benchSections(benchOfPool(pool)).map((s) => s.key)).toEqual(["main"]);
  });

  it("keeps a raid night's bench as one unlabelled list", () => {
    // A log records an actor, not a roster status — so there is nothing to
    // split on, and this must render exactly as it always has.
    const pool: PoolMember[] = [{ name: "Katzewarr" }, { name: "Somepug" }];
    const sections = benchSections(benchOfPool(pool));
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ key: "all", label: "" });
    expect(sections[0].members.map((m) => m.name)).toEqual(["Katzewarr", "Somepug"]);
  });

  it("preserves the pool's class order inside a section rather than re-sorting", () => {
    const pool = poolFromRoster([
      rosterMember({ name: "Zwarrior", wowClass: "Warrior" }),
      rosterMember({ name: "Adruid", wowClass: "Druid" }),
      rosterMember({ name: "Mhunter", wowClass: "Hunter" }),
    ]);
    const [mains] = benchSections(benchOfPool(pool));
    expect(mains.members.map((m) => m.wowClass)).toEqual(["Druid", "Hunter", "Warrior"]);
  });

  it("gives a benched name the pool no longer has somewhere to stand", () => {
    // A guild roster's bench is derived, so this can't normally happen — but a
    // section list that silently dropped somebody would be the worst way to
    // find out it can.
    const bench = boardView(
      { groups: [[], [], [], [], [], [], [], []], bench: [{ name: "Amain" }, { name: "Ghost" }] },
      poolFromRoster([rosterMember({ name: "Amain", status: "main" })]),
    ).bench;
    const sections = benchSections(bench);
    expect(sections.map((s) => [s.label, s.members.map((m) => m.name)])).toEqual([
      ["Mains", ["Amain"]],
      ["Not on the roster", ["Ghost"]],
    ]);
  });
});

describe("recruitedProspects", () => {
  it("names the prospects the roster now has", () => {
    const got = recruitedProspects(
      [{ name: "Newshaman" }, { name: "Stillatrial" }],
      [rosterMember({ name: "newshaman" })],
    );
    expect(got).toEqual(["Newshaman"]);
  });
});

describe("sanitizeProspects", () => {
  it("drops junk, blanks and duplicate names", () => {
    expect(
      sanitizeProspects([
        { name: "  Trial  " },
        { name: "" },
        { name: "TRIAL" },
        null,
        "Trial",
        { wowClass: "Mage" },
      ]),
    ).toEqual([{ name: "Trial" }]);
  });

  it("keeps class, spec and a legal role, and drops an illegal one", () => {
    expect(
      sanitizeProspects([
        { name: "A", wowClass: "Shaman", spec: "Restoration", role: "healer" },
        { name: "B", role: "raid leader" },
      ]),
    ).toEqual([
      { name: "A", wowClass: "Shaman", spec: "Restoration", role: "healer" },
      { name: "B" },
    ]);
  });

  it("reads a missing list as none rather than throwing", () => {
    expect(sanitizeProspects(undefined)).toEqual([]);
    expect(sanitizeProspects("nonsense")).toEqual([]);
  });
});

describe("sanitizeGuildRoster", () => {
  it("rejects a row with no id or no name rather than inventing one", () => {
    expect(sanitizeGuildRoster({ name: "Core" })).toBeUndefined();
    expect(sanitizeGuildRoster({ id: "b1" })).toBeUndefined();
    expect(sanitizeGuildRoster(null)).toBeUndefined();
  });

  it("keeps the group count the board was saved with", () => {
    const board = sanitizeGuildRoster({
      id: "b1",
      name: "Split A",
      createdAt: "2026-08-01T00:00:00.000Z",
      board: { groups: [[{ name: "Katzewarr" }], [], []] },
    });
    expect(board?.board.groups).toHaveLength(3);
    expect(board?.board.groups[0]).toEqual([{ name: "Katzewarr" }]);
  });

  it("survives a board with nothing in it — an officer who cleared it keeps the name", () => {
    const board = sanitizeGuildRoster({ id: "b1", name: "Core" });
    expect(board).toMatchObject({ id: "b1", name: "Core", prospects: [] });
    expect(board?.board.groups).toHaveLength(GROUP_COUNT);
  });
});

describe("newGuildRoster / nextRosterName", () => {
  it("starts empty, with the whole raid's worth of groups", () => {
    const board = newGuildRoster("b1", "Core", "2026-08-06T00:00:00.000Z");
    expect(board.board.groups).toHaveLength(GROUP_COUNT);
    expect(board.prospects).toEqual([]);
  });

  it("falls back to a name rather than an empty pill", () => {
    expect(newGuildRoster("b1", "   ", "now").name).toBe("Roster");
  });

  it("skips the numbers already taken, case and space insensitively", () => {
    expect(nextRosterName([])).toBe("Roster 1");
    expect(nextRosterName([{ name: "Roster 1" }, { name: " roster 2 " }])).toBe("Roster 3");
    expect(nextRosterName([{ name: "Core" }])).toBe("Roster 1");
  });
});

describe("selectBoard", () => {
  const known = { reportCodes: ["ABC123"], rosterIds: ["b1", "b2"] };

  it("defaults to the guild's own rosters, not the template", () => {
    // The page is opened to sort out Wednesday. The template is deliberate.
    expect(selectBoard(undefined, known)).toEqual({ tab: "rosters", rosterId: "b1" });
  });

  it("opens the template when asked for it", () => {
    expect(selectBoard("template", known)).toEqual({ tab: "template" });
  });

  it("reads the two values the tab links actually write", () => {
    // `rosters` resolves the same way the default does — spelled out anyway,
    // because a value the app emits shouldn't rely on being unrecognised.
    expect(selectBoard("rosters", known)).toEqual({ tab: "rosters", rosterId: "b1" });
    expect(selectBoard("template", known)).toEqual({ tab: "template" });
  });

  it("keeps no aliases for the names this parameter used to have", () => {
    /*
     * `roster`, `planner` and `guild` were all `?pool=` values at some point.
     * None of them is read any more — they land on the default, which is the
     * rosters tab, so an old bookmark opens something sensible rather than
     * silently opening the *wrong* board. That last part is why the current
     * rosters value is plural: `roster` used to mean the template.
     */
    for (const stale of ["roster", "planner", "guild"]) {
      expect(selectBoard(stale, known), stale).toEqual({ tab: "rosters", rosterId: "b1" });
    }
  });

  it("reads a bare report code as that raid night", () => {
    expect(selectBoard("ABC123", known)).toEqual({ tab: "rosters", reportCode: "ABC123" });
  });

  it("opens a guild roster by id", () => {
    expect(selectBoard(rosterBoardKey("b2"), known)).toEqual({ tab: "rosters", rosterId: "b2" });
  });

  it("falls back to the first roster for one that was deleted", () => {
    // Not to the template: the officer asked for a roster, and landing on a
    // different tab entirely reads as the link having been wrong.
    expect(selectBoard(rosterBoardKey("gone"), known)).toEqual({ tab: "rosters", rosterId: "b1" });
  });

  it("opens the rosters tab with nothing when there are none yet", () => {
    expect(selectBoard(undefined, { reportCodes: [], rosterIds: [] })).toEqual({
      tab: "rosters",
      rosterId: undefined,
    });
  });

  it("treats an unknown report code as the default rather than a blank raid", () => {
    expect(selectBoard("NOTAREPORT", known)).toEqual({ tab: "rosters", rosterId: "b1" });
  });
});
