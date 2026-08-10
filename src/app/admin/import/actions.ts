"use server";

import { z } from "zod";
import { getWriteRepo } from "@/lib/data/repo";
import { refreshAfterWrite } from "@/lib/refresh";
import { parseSixtyUpgradesExport } from "@/lib/import/sixtyupgrades";
import { parseGargulExport } from "@/lib/import/gargul";
import { phaseSchema } from "@/lib/import/schemas";
import { mergeItemFacts } from "@/lib/items/item-data";
import { resolveItemsFromWowhead } from "@/lib/items/wowhead";
import { GEAR_SET_KINDS, PHASES, SLOT_IDS } from "@/lib/constants/wow";
import type { GearSet, Item, SlotItem } from "@/lib/types";

/**
 * Import commits. Everything is re-parsed and re-validated server side — the
 * client preview is a convenience, never a contract. After any write the whole
 * route tree is revalidated: every page renders from the same small database.
 */

const sixtyInputSchema = z.object({
  json: z.string().min(1),
  characterName: z.string().min(1),
  kind: z.enum(GEAR_SET_KINDS),
  phase: phaseSchema.optional(),
  /** False on first submit; true when the user confirmed replacing the existing set. */
  confirmReplace: z.boolean(),
});

export type SixtyCommitInput = z.infer<typeof sixtyInputSchema>;

export type SixtyCommitResult =
  | { status: "error"; message: string }
  /** A set of this kind/phase already exists — show the diff, ask to confirm. */
  | {
      status: "needs-confirm";
      existing: {
        name: string;
        importedAt: string;
        slotCount: number;
        slots: SlotItem[];
      };
    }
  | {
      status: "committed";
      replaced: boolean;
      characterName: string;
      kind: (typeof GEAR_SET_KINDS)[number];
      phase?: GearSet["phase"];
      setName: string;
      slotCount: number;
      warnings: string[];
    };

export async function commitSixtyUpgrades(rawInput: SixtyCommitInput): Promise<SixtyCommitResult> {
  const inputParse = sixtyInputSchema.safeParse(rawInput);
  if (!inputParse.success) return { status: "error", message: "Invalid import request." };
  const input = inputParse.data;
  if (input.kind === "wishlist" && input.phase === undefined) {
    return { status: "error", message: "Pick a phase for the wishlist." };
  }

  const parsed = parseSixtyUpgradesExport(input.json);
  if (!parsed.ok) return { status: "error", message: parsed.error };
  const warnings = [...parsed.parsed.warnings];

  try {
    const repo = await getWriteRepo();
    const character = await repo.findCharacterByName(input.characterName);
    if (!character) {
      return { status: "error", message: `No roster character named “${input.characterName}”. Add them on the roster page first.` };
    }
    const exportedName = parsed.parsed.character?.name;
    if (exportedName && exportedName.toLowerCase() !== character.name.toLowerCase()) {
      warnings.push(`The export says it belongs to “${exportedName}” but was imported onto ${character.name}.`);
    }

    const phase = input.kind === "wishlist" ? input.phase : undefined;
    if (phase !== undefined && parsed.parsed.phase !== undefined && parsed.parsed.phase !== phase) {
      warnings.push(`The export is built for P${parsed.parsed.phase} but was imported as a P${phase} wishlist.`);
    }
    const defaultName =
      input.kind === "current" ? "Current gear" : `P${phase} wishlist`;
    const result = await repo.upsertGearSet(
      {
        characterId: character.id,
        kind: input.kind,
        phase,
        name: parsed.parsed.setName ?? defaultName,
        source: "sixtyupgrades",
        stats: parsed.parsed.stats,
        slots: parsed.parsed.slots,
      },
      { replace: input.confirmReplace },
    );

    if (result.status === "exists") {
      return {
        status: "needs-confirm",
        existing: {
          name: result.existing.name,
          importedAt: result.existing.importedAt,
          slotCount: result.existing.slots.length,
          slots: result.existing.slots,
        },
      };
    }

    refreshAfterWrite("/", "layout");
    return {
      status: "committed",
      replaced: result.status === "replaced",
      characterName: character.name,
      kind: input.kind,
      phase,
      setName: result.set.name,
      slotCount: result.set.slots.length,
      warnings,
    };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : "Import failed." };
  }
}

const gargulInputSchema = z.object({
  text: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Set the raid date."),
  zones: z.array(z.string().min(1)).min(1, "Pick at least one zone."),
  note: z.string().optional(),
});

export type GargulCommitInput = z.infer<typeof gargulInputSchema>;

export type GargulCommitActionResult =
  | { status: "error"; message: string }
  | {
      status: "committed";
      /** Undefined when every award was already recorded — no session was created. */
      sessionId?: string;
      inserted: number;
      skippedDuplicates: number;
      unresolved: string[];
      itemsCached: number;
      warnings: string[];
    };

const KNOWN_ZONES = new Set(PHASES.flatMap((p) => p.zones));

export async function commitGargul(rawInput: GargulCommitInput): Promise<GargulCommitActionResult> {
  const inputParse = gargulInputSchema.safeParse(rawInput);
  if (!inputParse.success) {
    return { status: "error", message: inputParse.error.issues[0]?.message ?? "Invalid import request." };
  }
  const input = inputParse.data;
  const badZone = input.zones.find((zone) => !KNOWN_ZONES.has(zone));
  if (badZone) return { status: "error", message: `Unknown zone “${badZone}”.` };

  const { lines, warnings } = parseGargulExport(input.text, { fallbackDate: input.date });
  if (lines.length === 0) {
    return {
      status: "error",
      message: warnings[0] ?? "No award lines could be parsed from the paste.",
    };
  }

  try {
    const repo = await getWriteRepo();
    // Gargul's standard export gives only an item id (no name) — fill the
    // denormalized name from the item cache so the ledger reads cleanly, with a
    // plain id placeholder for items we haven't cached yet.
    const nameById = new Map((await repo.listItems()).map((i) => [i.id, i.name]));
    // Ids that end up with a real name without asking Wowhead: the cache knew
    // one, or the paste itself carried an item link.
    const namedIds = new Set([
      ...[...nameById].filter(([, name]) => name !== undefined).map(([id]) => id),
      ...lines.filter((l) => l.itemName !== undefined).map((l) => l.itemId),
    ]);
    const result = await repo.createRaidSessionWithAwards(
      {
        date: input.date,
        zones: input.zones,
        note: input.note?.trim() || undefined,
        source: "gargul",
      },
      lines.map((l) => ({
        rawWinnerName: l.rawWinnerName,
        itemId: l.itemId,
        itemName: l.itemName ?? nameById.get(l.itemId) ?? `Item #${l.itemId}`,
        awardedAt: l.awardedAt,
        offspec: l.offspec,
      })),
    );

    // Item links in the paste carry a name and a quality (its color); plain
    // id lines carry neither. Cache whatever each line knew — no invented
    // icon, so the resolver still recognizes the gap and fills it later.
    const pasteItems: Item[] = mergeItemFacts(
      lines.map((l) => ({ id: l.itemId, name: l.itemName, quality: l.quality })),
    );
    let itemsCached = result.inserted > 0 ? await repo.addItemsIfMissing(pasteItems) : 0;

    // A paste of plain item ids leaves a handful of items with no name at all.
    // Resolve just those, right away — a raid's worth is a few lookups, and
    // the ledger reads properly the moment it's imported. Bigger backlogs are
    // the import page's "Backfill item data" button, not this.
    if (result.inserted > 0) {
      const unnamed = lines.map((l) => l.itemId).filter((id) => !namedIds.has(id));
      if (unnamed.length > 0) {
        const { resolved } = await resolveItemsFromWowhead(unnamed, { limit: 25 });
        if (resolved.length > 0) {
          itemsCached += await repo.saveResolvedItems(resolved);
          await repo.repairPlaceholderAwardNames();
        }
      }
    }

    if (result.inserted > 0) refreshAfterWrite("/", "layout");
    return {
      status: "committed",
      sessionId: result.session?.id,
      inserted: result.inserted,
      skippedDuplicates: result.skippedDuplicates,
      unresolved: result.unresolved,
      itemsCached,
      warnings,
    };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : "Import failed." };
  }
}

/* ---- Manual sets ------------------------------------------------------- */

const manualSlotSchema = z.object({
  slot: z.enum(SLOT_IDS),
  itemId: z.number().int().positive(),
  itemName: z.string().trim().max(120).optional(),
});

const manualInputSchema = z.object({
  characterName: z.string().min(1),
  kind: z.enum(GEAR_SET_KINDS),
  phase: phaseSchema.optional(),
  name: z.string().trim().max(120).optional(),
  slots: z.array(manualSlotSchema).min(1, "Add at least one slot."),
  confirmReplace: z.boolean(),
});

export type ManualSetInput = z.infer<typeof manualInputSchema>;

/**
 * Build a gear set by hand, without a SixtyUpgrades export.
 *
 * Two jobs. It gets a phase's list into the app when nobody has exported one —
 * the guild runs P2 with P3 lists imported, and the loot rules read lists from
 * every phase, so a missing phase is a hole in what the council can see. And it
 * makes those rules testable at all: before this, checking that a P4 list
 * behaves needed somebody to go and build one on SixtyUpgrades first.
 *
 * Goes through the same `upsertGearSet` as an import, so it takes the same
 * replace-confirmation path and its items land in the cache the same way. The
 * only difference is `source: "manual"`, which is what tells a reader months
 * later that a person typed this rather than a tool exporting it.
 *
 * Stats are deliberately empty: a hand-built list is a statement of what they
 * want, not a stat block, and inventing numbers would make the comparison view
 * quietly wrong.
 */
export async function commitManualGearSet(rawInput: ManualSetInput): Promise<SixtyCommitResult> {
  const parsed = manualInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid set." };
  }
  const input = parsed.data;
  if (input.kind === "wishlist" && input.phase === undefined) {
    return { status: "error", message: "Pick a phase for the wishlist." };
  }

  const seen = new Set<string>();
  for (const slot of input.slots) {
    if (seen.has(slot.slot)) {
      return { status: "error", message: `Two items for ${slot.slot}. One item per slot.` };
    }
    seen.add(slot.slot);
  }

  try {
    const repo = await getWriteRepo();
    const character = await repo.findCharacterByName(input.characterName);
    if (!character) {
      return {
        status: "error",
        message: `No roster character named “${input.characterName}”. Add them on the roster page first.`,
      };
    }

    const phase = input.kind === "wishlist" ? input.phase : undefined;
    const result = await repo.upsertGearSet(
      {
        characterId: character.id,
        kind: input.kind,
        phase,
        name: input.name || (input.kind === "current" ? "Current gear" : `P${phase} wishlist`),
        source: "manual",
        stats: {},
        slots: input.slots.map((s) => ({
          slot: s.slot,
          itemId: s.itemId,
          // The cache fills a blank in later; a placeholder now would stick.
          itemName: s.itemName || `Item ${s.itemId}`,
        })),
      },
      { replace: input.confirmReplace },
    );

    if (result.status === "exists") {
      return {
        status: "needs-confirm",
        existing: {
          name: result.existing.name,
          importedAt: result.existing.importedAt,
          slotCount: result.existing.slots.length,
          slots: result.existing.slots,
        },
      };
    }

    refreshAfterWrite("/", "layout");
    return {
      status: "committed",
      replaced: result.status === "replaced",
      characterName: character.name,
      kind: input.kind,
      phase,
      setName: result.set.name,
      slotCount: result.set.slots.length,
      warnings: [],
    };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : "Saving the set failed." };
  }
}
