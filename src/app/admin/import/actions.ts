"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getWriteRepo } from "@/lib/data/repo";
import { parseSixtyUpgradesExport } from "@/lib/import/sixtyupgrades";
import { parseGargulExport } from "@/lib/import/gargul";
import { phaseSchema } from "@/lib/import/schemas";
import { GEAR_SET_KINDS, PHASES } from "@/lib/constants/wow";
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

    revalidatePath("/", "layout");
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
        itemName: l.itemName,
        awardedAt: l.awardedAt,
        offspec: l.offspec,
      })),
    );

    // Item links in the paste carry name + quality — cache unknown items so
    // they render with a quality color (icon stays a placeholder until M3 backfill).
    const linkItems: Item[] = lines
      .filter((l) => l.quality !== undefined)
      .map((l) => ({ id: l.itemId, name: l.itemName, quality: l.quality!, icon: "inv_misc_questionmark" }));
    const itemsCached = result.inserted > 0 ? await repo.addItemsIfMissing(linkItems) : 0;

    if (result.inserted > 0) revalidatePath("/", "layout");
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
