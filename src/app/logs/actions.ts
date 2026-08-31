"use server";

import { z } from "zod";
import { getWriteRepo } from "@/lib/data/repo";
import { refreshAfterWrite } from "@/lib/refresh";
import { requireCapability } from "@/lib/auth/can";
import { resolveViewer } from "@/lib/auth/viewer";
import { attributeAdjustments } from "@/lib/analysis/consumable-adjustments";
import { actingOfficer } from "@/app/acting-officer";

const priceSchema = z.object({
  gold: z.number().min(0).max(1_000_000),
  charges: z.number().int().min(1).max(10_000),
});

const saveSchema = z.object({
  code: z.string().min(1),
  prices: z.record(z.string().min(1), priceSchema),
});

export type SavePricesInput = z.infer<typeof saveSchema>;
export type SavePricesResult = { ok: boolean; message: string };

/** Log this raid night's consumable prices for the gold-spent view. */
export async function saveReportConsumablePrices(input: SavePricesInput): Promise<SavePricesResult> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Those prices don't look valid." };
  try {
    requireCapability(await resolveViewer(), "logs.edit");
    const repo = await getWriteRepo();
    await repo.setReportConsumablePrices(parsed.data.code, parsed.data.prices);
    refreshAfterWrite("/logs");
    return { ok: true, message: "Saved this raid's prices." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not save prices." };
  }
}

const paybackSchema = z.object({
  code: z.string().min(1),
  /** Marks of Illidari the raid banked. Whole tokens — you cannot bank half. */
  marks: z.number().int().min(0).max(10_000),
  /** This week's gold value of one mark. */
  markGold: z.number().min(0).max(100_000),
  /** Gold already handed over, by logged raider name. */
  paid: z.record(z.string().min(1).max(80), z.number().min(0).max(1_000_000)),
});

export type SavePaybackInput = z.infer<typeof paybackSchema>;
export type SavePaybackResult = { ok: boolean; message: string };

/**
 * Record what a raid night banked to hand back, and what has gone out.
 *
 * The whole record is sent and replaces the stored one, the same way the prices
 * do — two officers editing one night at once means the later save wins outright
 * rather than merging. If that ever matters the fix is a targeted upsert per
 * raider, not more client state (change-chains §3).
 */
export async function saveReportPayback(input: SavePaybackInput): Promise<SavePaybackResult> {
  const parsed = paybackSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That payback record doesn't look valid." };
  try {
    requireCapability(await resolveViewer(), "logs.edit");
    const repo = await getWriteRepo();
    const { code, ...payback } = parsed.data;
    await repo.setReportPayback(code, payback);
    refreshAfterWrite("/logs");
    return { ok: true, message: "Saved this raid's payback." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not save the payback." };
  }
}

const fightFilterSchema = z.object({
  code: z.string().min(1),
  excludedFightIds: z.array(z.number().int().nonnegative()).max(200),
});

export type SaveFightFilterInput = z.infer<typeof fightFilterSchema>;
export type SaveFightFilterResult = { ok: boolean; message: string };

/**
 * Choose which pulls of this raid night feed its numbers. Excluded pulls stay
 * in the log but stop counting toward preparation, consumables, uptime and the
 * improvement list.
 */
export async function saveReportFightFilter(input: SaveFightFilterInput): Promise<SaveFightFilterResult> {
  const parsed = fightFilterSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That pull selection doesn't look valid." };
  try {
    requireCapability(await resolveViewer(), "logs.edit");
    const repo = await getWriteRepo();
    await repo.setReportExcludedFights(parsed.data.code, parsed.data.excludedFightIds);
    refreshAfterWrite("/logs");
    return { ok: true, message: "Saved which pulls count." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not save the pull selection." };
  }
}

const adjustmentSchema = z.object({
  actorName: z.string().min(1).max(60),
  name: z.string().min(1).max(80),
  // Zero would be a no-op pretending to be a correction.
  delta: z.number().int().refine((d) => d !== 0, "An adjustment has to add or remove something."),
  note: z.string().max(200).optional(),
  // Accepted so an untouched entry can carry its existing author back, but
  // never trusted for a changed one — `attributeAdjustments` restamps those.
  by: z.string().max(80).optional(),
  at: z.string().min(1),
});

const adjustmentsSchema = z.object({
  code: z.string().min(1),
  adjustments: z.array(adjustmentSchema).max(500),
});

export type SaveAdjustmentsInput = z.infer<typeof adjustmentsSchema>;
export type SaveAdjustmentsResult = { ok: boolean; message: string };

/**
 * Correct what this raid's logs say a raider got through.
 *
 * The whole set is replaced each save, so removing an entry is how you undo
 * one — the logged counts are never edited, which is what makes an undo
 * exact rather than approximate.
 */
export async function saveReportConsumableAdjustments(
  input: SaveAdjustmentsInput,
): Promise<SaveAdjustmentsResult> {
  const parsed = adjustmentsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "That adjustment doesn't look valid." };
  }
  try {
    requireCapability(await resolveViewer(), "logs.edit");
    const repo = await getWriteRepo();
    // Attribution is derived here, never taken from the client: the save
    // replaces the whole list, so only the entries it actually changed may
    // carry this officer's name. See `attributeAdjustments`.
    const { actor } = await actingOfficer();
    const stored = await repo.getReportConsumableAdjustments(parsed.data.code);
    const attributed = attributeAdjustments({
      stored,
      incoming: parsed.data.adjustments,
      actor,
      at: new Date().toISOString(),
    });
    await repo.setReportConsumableAdjustments(parsed.data.code, attributed);
    refreshAfterWrite("/", "layout");
    const n = parsed.data.adjustments.length;
    return {
      ok: true,
      message: n === 0 ? "Cleared every adjustment — back to what the log says." : `Saved ${n} adjustment${n === 1 ? "" : "s"}.`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not save the adjustments." };
  }
}
