import { SLOT_IDS, slotFamilyMembers } from "@/lib/constants/wow";
import { encounterSummary, type LoggedGearSlot, type LoggedGearView } from "@/lib/analysis/logged-gear";
import type { CurrentGearOverride, GearSet, Quality, SlotId } from "@/lib/types";

/**
 * "What are they wearing right now", reconciled.
 *
 * Two sources disagree by design. A SixtyUpgrades export is a snapshot of
 * intent, accurate the day it was pasted and stale by the next raid night. The
 * logs are the opposite — ground truth for every pull, but they only say what
 * was worn, never what the raider considers their set.
 *
 * An override is an officer settling the argument for one slot: pin the item
 * the logs show and everything downstream (the wishlist "Currently" column,
 * completion, contention) follows without waiting for a re-export. The import
 * still owns every slot nobody pinned, so a fresh export keeps improving the
 * picture instead of being fought by it.
 */

/**
 * How many raid nights the pinnable-item list looks back over. Far enough to
 * catch a swap set (resist gear, a threat trinket), recent enough that gear
 * they've since replaced doesn't linger on the profile. Shared by the profile
 * and the server action, so what's offered is exactly what's accepted.
 */
export const LOGGED_GEAR_RAIDS = 3;

/** The id of the set synthesised for a character who has pins but no import. */
export function overrideSetId(characterId: string): string {
  return `cgo_${characterId}`;
}

/**
 * The character's effective current gear: the imported set with pinned slots
 * swapped in. With pins but no import the pins ARE the set — an officer can
 * build current gear straight out of the logs for a raider who never exported
 * one. Its stat block is empty, which is honest: we only ever diff stats
 * SixtyUpgrades computed, never our own.
 */
export function applyCurrentGearOverrides(
  imported: GearSet | undefined,
  overrides: CurrentGearOverride[],
): GearSet | undefined {
  if (overrides.length === 0) return imported;
  const pinned = new Map(overrides.map((o) => [o.item.slot, o.item] as const));

  if (!imported) {
    const characterId = overrides[0].characterId;
    return {
      id: overrideSetId(characterId),
      characterId,
      kind: "current",
      name: "Current gear (set by hand)",
      source: "manual",
      importedAt: overrides.map((o) => o.setAt).sort().at(-1)!,
      stats: {},
      slots: SLOT_IDS.filter((s) => pinned.has(s)).map((s) => pinned.get(s)!),
    };
  }

  const covered = new Set(imported.slots.map((s) => s.slot));
  return {
    ...imported,
    slots: [
      ...imported.slots.map((s) => pinned.get(s.slot) ?? s),
      // Slots the export left out but an officer filled in from the logs.
      ...SLOT_IDS.filter((s) => !covered.has(s) && pinned.has(s)).map((s) => pinned.get(s)!),
    ],
  };
}

/** One item an officer can pin into a slot, with the evidence for offering it. */
export interface LoggedSlotOption {
  itemId: number;
  name?: string;
  quality?: Quality;
  icon?: string;
  /** "12 of 18 pulls · Hydross ×8 · Lurker ×4" — why this item is on the list. */
  detail: string;
  /** Seen on the paired slot (the other ring / trinket), not this one. */
  fromPairedSlot: boolean;
  /** Worn in this slot on their most recent logged pull — the best "right now" answer. */
  latest: boolean;
}

/**
 * Everything worn per slot over the raid nights in scope, as pick-list options.
 *
 * Rings and trinkets pool with their partner: which finger a ring sits on is
 * arbitrary, so both are offered for either slot (flagged, so the UI can say
 * where it was actually seen). Own slot first, then the partner's; within each,
 * the ordering `buildLoggedGear` produced — most recently worn first.
 */
export function loggedSlotOptions(view: LoggedGearView): Map<SlotId, LoggedSlotOption[]> {
  const bySlotId = new Map<SlotId, LoggedGearSlot>();
  for (const logged of view.slots) if (logged.slot) bySlotId.set(logged.slot, logged);

  const out = new Map<SlotId, LoggedSlotOption[]>();
  for (const slot of SLOT_IDS) {
    const options: LoggedSlotOption[] = [];
    const seen = new Set<number>();
    for (const member of slotFamilyMembers(slot)) {
      const logged = bySlotId.get(member);
      if (!logged) continue;
      for (const option of logged.options) {
        if (seen.has(option.itemId)) continue;
        seen.add(option.itemId);
        options.push({
          itemId: option.itemId,
          name: option.name,
          quality: option.quality,
          icon: option.icon,
          detail: `${option.pulls} of ${logged.slotPulls} pulls · ${encounterSummary(option)}`,
          fromPairedSlot: member !== slot,
          latest: option.current && member === slot,
        });
      }
    }
    if (options.length > 0) out.set(slot, options);
  }
  return out;
}
