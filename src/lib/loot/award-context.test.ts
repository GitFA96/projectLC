import { afterEach, describe, expect, it, vi } from "vitest";
import { PHASES } from "@/lib/constants/wow";
import { buildAwardContext, buildAwardTarget } from "@/lib/loot/award-context";
import type { Guild, RaidSession } from "@/lib/types";

/**
 * The dropdowns an officer sees when they hand something over by hand.
 *
 * Two pages build this — a character's profile and an item's contention page —
 * and the reason it is one function is that they must offer the same raids in
 * the same order. An officer filing the same award from two places should not
 * have to notice which page they are on.
 *
 * What is worth pinning here is small and all of it is about defaults: the
 * night at the top of the list is the one that gets picked when somebody is in
 * a hurry, and the zone at the top is the one an award lands in when nobody
 * changes it.
 */

const guild = (activePhase: Guild["activePhase"]): Guild => ({
  id: "g",
  name: "Test",
  realm: "Firemaw",
  faction: "Horde",
  activePhase,
  visibility: "private",
});

const session = (date: string, zones = ["Karazhan"], id = date): RaidSession => ({
  id,
  guildId: "g",
  date,
  zones,
  source: "manual",
});

afterEach(() => vi.useRealTimers());

describe("the raid nights offered", () => {
  it("puts the most recent night first", () => {
    const { sessions } = buildAwardTarget(
      guild(1),
      [session("2026-07-01"), session("2026-08-30"), session("2026-08-02")],
    );
    expect(sessions.map((s) => s.id)).toEqual(["2026-08-30", "2026-08-02", "2026-07-01"]);
  });

  it("offers the twelve most recent and stops", () => {
    // A guild that has raided for a year has hundreds. The list is a
    // convenience for filing tonight's loot, not an archive.
    const nights = Array.from({ length: 40 }, (_, i) =>
      session(`2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`, ["Karazhan"], `s${i}`),
    );
    expect(buildAwardTarget(guild(1), nights).sessions).toHaveLength(12);
  });

  it("labels a night by its date and every zone it covered", () => {
    const { sessions } = buildAwardTarget(guild(3), [
      session("2026-08-30", ["Mount Hyjal", "Black Temple"]),
    ]);
    expect(sessions[0].label).toBe("30 Aug 2026 — Mount Hyjal + Black Temple");
  });

  it("copes with a guild that has never raided", () => {
    expect(buildAwardTarget(guild(1), []).sessions).toEqual([]);
  });
});

describe("the zones offered", () => {
  it("leads with the active phase's raids, because that is where loot is dropping", () => {
    const { zones, defaultZone } = buildAwardTarget(guild(3), []);
    expect(zones.slice(0, 2)).toEqual(["Mount Hyjal", "Black Temple"]);
    expect(defaultZone).toBe("Mount Hyjal");
  });

  it("still offers every other raid, once each, for a late Karazhan clear", () => {
    const { zones } = buildAwardTarget(guild(3), []);
    const all = PHASES.flatMap((p) => p.zones);
    expect(new Set(zones)).toEqual(new Set(all));
    // The active phase's zones appear at the front AND in progression order
    // further down; the Set collapses them, and this asserts that it did.
    expect(zones).toHaveLength(all.length);
  });

  it("falls back to the first raid in the game when a guild's phase names none", () => {
    // `activePhase` is a stored integer. A phase added to PHASE_IDS before its
    // zones are filled in would otherwise leave the dialog with no default at
    // all, and the officer with an award that files itself nowhere.
    const orphan = { ...guild(1), activePhase: 99 as Guild["activePhase"] };
    const { defaultZone, zones } = buildAwardTarget(orphan, []);
    expect(defaultZone).toBe(PHASES[0].zones[0]);
    expect(zones).toHaveLength(PHASES.flatMap((p) => p.zones).length);
  });

  it.each(PHASES.map((p) => [p.phase, p.zones[0]] as const))(
    "phase %i defaults to %s",
    (phase, first) => {
      expect(buildAwardTarget(guild(phase), []).defaultZone).toBe(first);
    },
  );
});

describe("the date the dialog opens on", () => {
  it("is today, as a plain ISO day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T21:45:00Z"));
    expect(buildAwardTarget(guild(1), []).today).toBe("2026-08-30");
  });
});

describe("naming the raider", () => {
  it("stamps the character on, and changes nothing else", () => {
    const target = buildAwardTarget(guild(2), [session("2026-08-30")]);
    const context = buildAwardContext({ id: "c1", name: "Thrainn" }, guild(2), [
      session("2026-08-30"),
    ]);
    const { characterId, characterName, ...rest } = context;
    expect(characterId).toBe("c1");
    expect(characterName).toBe("Thrainn");
    // A contested item ships one target and many candidate winners, so the
    // two must agree on everything except who is winning.
    expect(rest).toEqual(target);
  });
});
