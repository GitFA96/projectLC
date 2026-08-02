"use server";

import { getWriteRepo } from "@/lib/data/repo";
import { refreshAfterWrite } from "@/lib/refresh";
import { buildLoggedGear, type LoggedGearReport } from "@/lib/analysis/logged-gear";
import { LOGGED_GEAR_RAIDS, loggedSlotOptions, reportsInSpec } from "@/lib/analysis/current-gear";
import { itemDisplayName } from "@/lib/items/item-data";
import { SLOT_IDS, SLOT_LABELS } from "@/lib/constants/wow";
import type { Character, GearOverrideSource, GearSpec, SlotId, SlotItem } from "@/lib/types";

/**
 * Pinning a slot of someone's current gear from what the logs show they wore.
 *
 * The client only ever sends a slot and an item id: the name, and the right to
 * pin it at all, are re-derived here from the same recent-raids window the
 * profile offered — so what gets stored is always something they were actually
 * seen wearing, not whatever id a form was talked into submitting.
 *
 * Every action takes a `spec`. "main" is the kit loot is judged on; "off" is
 * the parallel kit for the spec they step into for the guild, and only exists
 * once an officer has recorded an off-spec on the character.
 */

export interface SetCurrentSlotInput {
  /** Character slug/name, as the profile route has it. */
  characterName: string;
  slot: SlotId;
  /** The item to pin; null unpins the slot. */
  itemId: number | null;
  /**
   * Where it was picked from, which decides how it's checked:
   *  - "logs" (default): must be something they were logged wearing recently.
   *  - "manual": any item the database already knows, for gear that predates
   *    the logs or was won on an unlogged night.
   */
  source?: GearOverrideSource;
  /** Which kit is being edited. Defaults to their main-spec gear. */
  spec?: GearSpec;
}

export interface CurrentGearActionResult {
  ok: boolean;
  message: string;
}

function isSlotId(value: string): value is SlotId {
  return (SLOT_IDS as readonly string[]).includes(value);
}

/**
 * The raid nights a kit's pins may be read from, and what to call it.
 *
 * For the off-spec kit that's only the pulls they actually played it on —
 * their main-spec set from the same night says nothing about what they field
 * as a tank. An off-spec kit on a character with no off-spec recorded is
 * refused rather than quietly stored: it would be invisible everywhere.
 */
function kitScope(
  character: Character,
  spec: GearSpec,
): { ok: true; label: string; filterSpec?: string } | { ok: false; message: string } {
  if (spec !== "off") return { ok: true, label: "current gear" };
  if (!character.offSpec) {
    return {
      ok: false,
      message: `${character.name} has no off-spec recorded — set one first.`,
    };
  }
  return { ok: true, label: `${character.offSpec} off-spec gear`, filterSpec: character.offSpec };
}

/** The recent-raids window for one kit, newest night first. */
function loggedWindow(
  reports: LoggedGearReport[],
  filterSpec: string | undefined,
): ReturnType<typeof buildLoggedGear> {
  return buildLoggedGear(reportsInSpec(reports, filterSpec), { limit: LOGGED_GEAR_RAIDS });
}

export async function setCurrentSlotAction(
  input: SetCurrentSlotInput,
): Promise<CurrentGearActionResult> {
  try {
    if (!isSlotId(input.slot)) return { ok: false, message: "Unknown gear slot." };
    const repo = await getWriteRepo();
    const character = await repo.findCharacterByName(input.characterName);
    if (!character) return { ok: false, message: "Character not found." };
    const spec: GearSpec = input.spec ?? "main";
    const scope = kitScope(character, spec);
    if (!scope.ok) return { ok: false, message: scope.message };

    if (input.itemId === null) {
      const cleared = await repo.clearCurrentGearOverride(character.id, input.slot, spec);
      refreshAfterWrite("/", "layout");
      return {
        ok: true,
        message: cleared
          ? spec === "off"
            ? `${SLOT_LABELS[input.slot]} cleared from their off-spec gear.`
            : `${SLOT_LABELS[input.slot]} is back to the imported set.`
          : `${SLOT_LABELS[input.slot]} wasn't pinned.`,
      };
    }

    if (!Number.isInteger(input.itemId) || input.itemId <= 0) {
      return { ok: false, message: "That isn't a valid item." };
    }

    // Picked by hand out of the item database: the only claim being made is
    // "this is what they have", so the item just has to be one we know.
    //
    // "Know" means the same index the picker searched, not just the item
    // cache. An award whose paste carried only an invented name never earns a
    // cache row, but it's still a real item the guild has handled — and being
    // offered something that then refuses to save is worse than either.
    if (input.source === "manual") {
      const cached = await repo.getItem(input.itemId);
      const known = cached ?? (await repo.listItemDemand()).find((d) => d.itemId === input.itemId);
      if (!known) {
        return {
          ok: false,
          message: "That item isn't in the database yet — import or award it first.",
        };
      }
      const result = await repo.setCurrentGearOverride(
        character.id,
        {
          slot: input.slot,
          itemId: input.itemId,
          itemName: itemDisplayName(input.itemId, cached?.name, known.name),
        },
        "manual",
        spec,
      );
      if (!result.ok) return { ok: false, message: result.error };
      refreshAfterWrite("/", "layout");
      return { ok: true, message: `${SLOT_LABELS[input.slot]} set to ${result.override.item.itemName}.` };
    }

    // Re-derive what was offered: only items from the same recent-raids window
    // the picker built its list from are pinnable.
    const performance = await repo.getCharacterPerformance(character.name);
    const reports: LoggedGearReport[] = (performance?.reports ?? []).map((r) => ({
      report: r.report,
      rows: r.rows,
    }));
    const options = loggedSlotOptions(loggedWindow(reports, scope.filterSpec));
    const chosen = options.get(input.slot)?.find((o) => o.itemId === input.itemId);
    if (!chosen) {
      return {
        ok: false,
        message:
          spec === "off"
            ? `${character.name} hasn't been logged wearing that in ${SLOT_LABELS[input.slot]} as ${character.offSpec} recently — refresh the page.`
            : `${character.name} hasn't been logged wearing that in ${SLOT_LABELS[input.slot]} recently — refresh the page.`,
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
      spec,
    );
    if (!result.ok) return { ok: false, message: result.error };

    refreshAfterWrite("/", "layout");
    return { ok: true, message: `${SLOT_LABELS[input.slot]} set to ${result.override.item.itemName}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Saving the slot failed." };
  }
}

export interface EquipLoggedGearInput {
  /** One character, or a whole selection when setting a roster up. */
  characterNames: string[];
  /**
   * Overwrite slots an officer already set by hand. False is the safe bulk
   * pass: fill in what nobody has answered yet and leave deliberate edits be.
   */
  replace: boolean;
  /**
   * Which kit to fill. "off" reads only the pulls they played their recorded
   * off-spec on, and skips anyone who has no off-spec — a roster-wide pass
   * stays a main-spec pass unless it's asked for otherwise.
   */
  spec?: GearSpec;
}

/**
 * Read what each raider was last logged wearing and record it as their current
 * gear, slot by slot.
 *
 * This is the "we just imported our logs, now set the roster up" button. A new
 * guild has no SixtyUpgrades exports and no time to type 25 raiders × 17 slots,
 * but the logs already know every one of those slots exactly — the data was
 * there the moment the first report was fetched, just never written down as
 * "current".
 *
 * Per slot it takes the item worn on their most recent pull within the same
 * recent-raids window the per-slot picker offers, so the button and the
 * dropdown can never disagree about what "latest" means.
 */
export async function equipLoggedGearAction(
  input: EquipLoggedGearInput,
): Promise<CurrentGearActionResult> {
  try {
    const repo = await getWriteRepo();
    const spec: GearSpec = input.spec ?? "main";
    let written = 0;
    let kept = 0;
    const done: string[] = [];
    const noLogs: string[] = [];
    const missing: string[] = [];
    const noOffSpec: string[] = [];

    for (const name of input.characterNames) {
      const character = await repo.findCharacterByName(name);
      if (!character) {
        missing.push(name);
        continue;
      }
      const scope = kitScope(character, spec);
      if (!scope.ok) {
        noOffSpec.push(character.name);
        continue;
      }
      const performance = await repo.getCharacterPerformance(character.name);
      const reports: LoggedGearReport[] = (performance?.reports ?? []).map((r) => ({
        report: r.report,
        rows: r.rows,
      }));
      const view = loggedWindow(reports, scope.filterSpec);

      // One item per slot: the one they had on in their most recent pull.
      // Rings and trinkets are read per finger, never pooled — pooling would
      // put the same ring on both hands.
      const items: SlotItem[] = [];
      for (const logged of view.slots) {
        const latest = logged.options.find((o) => o.current);
        if (!logged.slot || !latest) continue;
        const cached = await repo.getItem(latest.itemId);
        items.push({
          slot: logged.slot,
          itemId: latest.itemId,
          itemName: itemDisplayName(latest.itemId, latest.name, cached?.name),
        });
      }
      if (items.length === 0) {
        noLogs.push(character.name);
        continue;
      }

      const result = await repo.setCurrentGearOverrides(character.id, items, "logs", {
        replace: input.replace,
        spec,
      });
      if (!result.ok) return { ok: false, message: `${character.name}: ${result.error}` };
      written += result.written;
      kept += result.kept;
      if (result.written > 0) done.push(character.name);
    }

    refreshAfterWrite("/", "layout");

    if (written === 0 && done.length === 0) {
      const why =
        noOffSpec.length > 0 && noLogs.length === 0
          ? "no off-spec is recorded for them"
          : noLogs.length > 0
            ? spec === "off"
              ? "they haven't been logged playing that spec yet"
              : "nothing has been logged for them yet"
            : kept > 0
              ? "every slot the logs cover is already set by hand"
              : "there was nothing to set";
      return { ok: false, message: `No slots changed — ${why}.` };
    }
    const parts = [
      `${written} slot${written === 1 ? "" : "s"} set from the logs across ${done.length} character${done.length === 1 ? "" : "s"}`,
    ];
    if (kept > 0) parts.push(`${kept} left as set by hand`);
    if (noLogs.length > 0) parts.push(`${noLogs.length} with no logged gear skipped`);
    if (noOffSpec.length > 0) parts.push(`${noOffSpec.length} with no off-spec skipped`);
    if (missing.length > 0) parts.push(`${missing.length} not found`);
    return { ok: true, message: `${parts.join(" · ")}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Reading the logs failed." };
  }
}

/** Drop every pinned slot of one kit — the main set goes back to the import. */
export async function clearCurrentSlotsAction(
  characterName: string,
  spec: GearSpec = "main",
): Promise<CurrentGearActionResult> {
  try {
    const repo = await getWriteRepo();
    const character = await repo.findCharacterByName(characterName);
    if (!character) return { ok: false, message: "Character not found." };
    const cleared = await repo.clearCurrentGearOverrides(character.id, spec);
    refreshAfterWrite("/", "layout");
    return {
      ok: true,
      message:
        cleared === 0
          ? "Nothing was pinned."
          : spec === "off"
            ? `${cleared} off-spec slot${cleared === 1 ? "" : "s"} cleared.`
            : `${cleared} slot${cleared === 1 ? "" : "s"} back to the imported set.`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Clearing failed." };
  }
}
