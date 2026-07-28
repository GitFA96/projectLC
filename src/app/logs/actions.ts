"use server";

import { z } from "zod";
import { getWriteRepo } from "@/lib/data/repo";
import { refreshAfterWrite } from "@/lib/refresh";

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
    const repo = await getWriteRepo();
    await repo.setReportConsumablePrices(parsed.data.code, parsed.data.prices);
    refreshAfterWrite("/logs");
    return { ok: true, message: "Saved this raid's prices." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not save prices." };
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
    const repo = await getWriteRepo();
    await repo.setReportExcludedFights(parsed.data.code, parsed.data.excludedFightIds);
    refreshAfterWrite("/logs");
    return { ok: true, message: "Saved which pulls count." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not save the pull selection." };
  }
}
