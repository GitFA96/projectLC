"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getWriteRepo } from "@/lib/data/repo";

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
    revalidatePath("/logs");
    return { ok: true, message: "Saved this raid's prices." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not save prices." };
  }
}
