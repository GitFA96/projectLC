import { describe, expect, it } from "vitest";
import {
  RAID_WEEK_DAYS,
  RECENT_DAYS,
  dayOf,
  inLootWindow,
  isLootWindowKey,
  lootWindowRange,
} from "@/lib/analysis/loot-recency";

/* The shape the ledger actually stores: a session date wearing a time. */
const award = (day: string) => `${day}T00:00:00`;

describe("lootWindowRange", () => {
  it("anchors the raid week to the last raid, not to today", () => {
    // The case this exists for: the newest loot session is eight days old, so a
    // window measured from today would be empty on the day somebody opens it.
    const range = lootWindowRange("week", "2026-08-19", "2026-08-27");
    expect(range).toEqual({ from: "2026-08-13", to: "2026-08-19" });
    expect(inLootWindow(award("2026-08-19"), range)).toBe(true);
  });

  it("spans a whole raid week inclusive of both ends", () => {
    const range = lootWindowRange("week", "2026-08-19", "2026-08-19")!;
    const days = [];
    for (let d = 13; d <= 19; d++) days.push(`2026-08-${d}`);
    expect(days).toHaveLength(RAID_WEEK_DAYS);
    expect(days.every((d) => inLootWindow(award(d), range))).toBe(true);
    // The day before it opens is out, so two raid weeks can never overlap.
    expect(inLootWindow(award("2026-08-12"), range)).toBe(false);
  });

  it("crosses a month boundary without arithmetic of its own", () => {
    expect(lootWindowRange("week", "2026-09-02", "2026-09-02")).toEqual({
      from: "2026-08-27",
      to: "2026-09-02",
    });
  });

  it("measures the rolling window from today, because that is what it says", () => {
    const range = lootWindowRange("recent", "2026-08-19", "2026-08-27")!;
    expect(range.to).toBe("2026-08-27");
    expect(range.from).toBe("2026-07-29");
    expect(inLootWindow(award("2026-08-19"), range)).toBe(true);
    expect(inLootWindow(award("2026-07-28"), range)).toBe(false);
  });

  it("has no raid week when the guild has no loot at all", () => {
    // Collapses to nothing rather than to "everything" — a new guild's card
    // should be empty, not show every award ever imported.
    expect(lootWindowRange("week", undefined, "2026-08-27")).toBeUndefined();
  });

  it("filters nothing under 'all'", () => {
    expect(lootWindowRange("all", "2026-08-19", "2026-08-27")).toBeUndefined();
    expect(inLootWindow(award("2019-01-01"), undefined)).toBe(true);
  });
});

describe("dayOf", () => {
  it("compares by day, not by the timestamp string", () => {
    // Every award of a night shares one midnight timestamp today. The moment an
    // import records a real clock time, a string compare would start dropping
    // the last night of a window — this is what keeps that from happening.
    expect(dayOf("2026-08-19T00:00:00")).toBe("2026-08-19");
    expect(dayOf("2026-08-19T21:47:03.512Z")).toBe("2026-08-19");
    const range = lootWindowRange("week", "2026-08-19", "2026-08-19");
    expect(inLootWindow("2026-08-19T21:47:03.512Z", range)).toBe(true);
  });
});

describe("isLootWindowKey", () => {
  it("guards what arrives from the URL", () => {
    expect(isLootWindowKey("week")).toBe(true);
    expect(isLootWindowKey("recent")).toBe(true);
    expect(isLootWindowKey("last-tuesday")).toBe(false);
  });

  it("names the rolling window after the number of days it covers", () => {
    expect(lootWindowRange("recent", undefined, "2026-01-30")).toEqual({
      from: `2026-01-0${31 - RECENT_DAYS}`,
      to: "2026-01-30",
    });
  });
});
