import { describe, expect, it } from "vitest";
import {
  ANY_CLASS,
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
    // A cooldown is always somebody's button.
    for (const c of CLASS_COOLDOWNS) expect(WCL_CLASSES.has(c.wowClass)).toBe(true);
    for (const t of UPTIME_TRACKS) {
      expect(WCL_CLASSES.has(t.wowClass) || t.wowClass === ANY_CLASS).toBe(true);
    }
  });

  it("never marks a selfbuff class-less", () => {
    // A selfbuff is credited only when provider === the buffed player, which
    // normalize resolves through the class when the log names no source. That
    // is meaningless for ANY_CLASS, so such a track could never be credited.
    // Consumable debuffs and item-sourced party buffs are fine: an un-sourced
    // instance stays unattributed rather than being pinned on the wrong player.
    for (const t of UPTIME_TRACKS) {
      if (t.wowClass === ANY_CLASS) expect(t.kind).not.toBe("selfbuff");
    }
  });

  it("keeps class-less tracks out of every class's toolkit", () => {
    for (const c of ["Warrior", "Druid", "Priest"]) {
      expect(uptimeTracksForClass(c).some((t) => t.wowClass === ANY_CLASS)).toBe(false);
    }
  });

  it("class lookups return that class's toolkit", () => {
    expect(cooldownsForClass("Warrior").map((c) => c.name)).toContain("Death Wish");
    // Warlocks track their curse assignment AND personal DoT upkeep.
    const warlock = uptimeTracksForClass("Warlock").map((t) => t.name);
    expect(warlock).toContain("Curse of the Elements");
    expect(warlock).toContain("Corruption");
    // Enhancement's rotation: Stormstrike on CD, Flame Shock rolling.
    const shaman = uptimeTracksForClass("Shaman").map((t) => t.name);
    expect(shaman).toContain("Flame Shock");
    expect(shaman).toContain("Stormstrike");
    expect(cooldownsForClass("Shaman").map((c) => c.name)).toContain("Shamanistic Rage");
    expect(cooldownsForClass(undefined)).toEqual([]);
  });
});
