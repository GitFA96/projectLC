import { describe, expect, it } from "vitest";
import {
  CLASS_COOLDOWNS,
  COOLDOWN_CAST_IDS,
  UPTIME_TRACKS,
  cooldownsForClass,
  uptimeTracksForClass,
} from "@/lib/wcl/class-tracks";
import { TRACKED_CAST_IDS } from "@/lib/wcl/consumables";

const WCL_CLASSES = new Set([
  "Druid", "Hunter", "Mage", "Paladin", "Priest", "Rogue", "Shaman", "Warlock", "Warrior",
]);

describe("class tracks", () => {
  it("cooldown spell ids never collide with each other or with consumables", () => {
    // A shared id would mis-attribute a cast; the sets must stay disjoint.
    expect(new Set(COOLDOWN_CAST_IDS).size).toBe(COOLDOWN_CAST_IDS.length);
    const consumables = new Set(TRACKED_CAST_IDS);
    expect(COOLDOWN_CAST_IDS.filter((id) => consumables.has(id))).toEqual([]);
  });

  it("uptime track names are unique (they are the match keys)", () => {
    const names = UPTIME_TRACKS.map((t) => t.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it("every entry belongs to a real class", () => {
    for (const c of CLASS_COOLDOWNS) expect(WCL_CLASSES.has(c.wowClass)).toBe(true);
    for (const t of UPTIME_TRACKS) expect(WCL_CLASSES.has(t.wowClass)).toBe(true);
  });

  it("class lookups return that class's toolkit", () => {
    expect(cooldownsForClass("Warrior").map((c) => c.name)).toContain("Death Wish");
    expect(uptimeTracksForClass("Warlock").every((t) => t.name.startsWith("Curse of"))).toBe(true);
    expect(cooldownsForClass(undefined)).toEqual([]);
  });
});
