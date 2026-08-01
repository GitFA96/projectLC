"use server";

import { getWriteRepo } from "@/lib/data/repo";
import { refreshAfterWrite } from "@/lib/refresh";
import { buildLoggedGear, type LoggedGearReport } from "@/lib/analysis/logged-gear";
import { LOGGED_GEAR_RAIDS, loggedSlotOptions } from "@/lib/analysis/current-gear";
import { itemDisplayName } from "@/lib/items/item-data";
import { SLOT_IDS, SLOT_LABELS } from "@/lib/constants/wow";
import type { SlotId } from "@/lib/types";

/**
 * Pinning a slot of someone's current gear from what the logs show they wore.
 *
 * The client only ever sends a slot and an item id: the name, and the right to
 * pin it at all, are re-derived here from the same recent-raids window the
 * profile offered — so what gets stored is always something they were actually
 * seen wearing, not whatever id a form was talked into submitting.
 */

export interface SetCurrentSlotInput {
  /** Character slug/name, as the profile route has it. */
  characterName: string;
  slot: SlotId;
  /** An item worn in that slot (or its pair) recently; null unpins the slot. */
  itemId: number | null;
}

export interface CurrentGearActionResult {
  ok: boolean;
  message: string;
}

function isSlotId(value: string): value is SlotId {
  return (SLOT_IDS as readonly string[]).includes(value);
}

export async function setCurrentSlotAction(
  input: SetCurrentSlotInput,
): Promise<CurrentGearActionResult> {
  try {
    if (!isSlotId(input.slot)) return { ok: false, message: "Unknown gear slot." };
    const repo = await getWriteRepo();
    const character = await repo.findCharacterByName(input.characterName);
    if (!character) return { ok: false, message: "Character not found." };

    if (input.itemId === null) {
      const cleared = await repo.clearCurrentGearOverride(character.id, input.slot);
      refreshAfterWrite("/", "layout");
      return {
        ok: true,
        message: cleared
          ? `${SLOT_LABELS[input.slot]} is back to the imported set.`
          : `${SLOT_LABELS[input.slot]} wasn't pinned.`,
      };
    }

    if (!Number.isInteger(input.itemId) || input.itemId <= 0) {
      return { ok: false, message: "That isn't a valid item." };
    }

    // Re-derive what was offered: only items from the same recent-raids window
    // the picker built its list from are pinnable.
    const performance = await repo.getCharacterPerformance(character.name);
    const reports: LoggedGearReport[] = (performance?.reports ?? []).map((r) => ({
      report: r.report,
      rows: r.rows,
    }));
    const options = loggedSlotOptions(buildLoggedGear(reports, { limit: LOGGED_GEAR_RAIDS }));
    const chosen = options.get(input.slot)?.find((o) => o.itemId === input.itemId);
    if (!chosen) {
      return {
        ok: false,
        message: `${character.name} hasn't been logged wearing that in ${SLOT_LABELS[input.slot]} recently — refresh the page.`,
      };
    }

    // The log's own name first, then whatever the cache learned; an id is a
    // last resort rather than an invention.
    const cached = await repo.getItem(chosen.itemId);
    const result = await repo.setCurrentGearOverride(
      character.id,
      {
        slot: input.slot,
        itemId: chosen.itemId,
        itemName: itemDisplayName(chosen.itemId, chosen.name, cached?.name),
      },
      "logs",
    );
    if (!result.ok) return { ok: false, message: result.error };

    refreshAfterWrite("/", "layout");
    return { ok: true, message: `${SLOT_LABELS[input.slot]} set to ${result.override.item.itemName}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Saving the slot failed." };
  }
}

/** Drop every pinned slot — the whole current set goes back to the import. */
export async function clearCurrentSlotsAction(characterName: string): Promise<CurrentGearActionResult> {
  try {
    const repo = await getWriteRepo();
    const character = await repo.findCharacterByName(characterName);
    if (!character) return { ok: false, message: "Character not found." };
    const cleared = await repo.clearCurrentGearOverrides(character.id);
    refreshAfterWrite("/", "layout");
    return {
      ok: true,
      message: cleared === 0 ? "Nothing was pinned." : `${cleared} slot${cleared === 1 ? "" : "s"} back to the imported set.`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Clearing failed." };
  }
}
