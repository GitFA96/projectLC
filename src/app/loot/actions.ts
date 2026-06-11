"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getWriteRepo } from "@/lib/data/repo";

/**
 * Manual winner resolution for awards whose winner didn't auto-match the
 * roster (typos, renames, cross-realm pugs, disenchants). Resolution only
 * touches the award's character link — item, timestamp and rawWinnerName are
 * immutable history.
 */

const resolveInputSchema = z.discriminatedUnion("resolution", [
  z.object({ awardId: z.string().min(1), resolution: z.literal("character"), characterId: z.string().min(1) }),
  z.object({ awardId: z.string().min(1), resolution: z.literal("external") }),
  z.object({ awardId: z.string().min(1), resolution: z.literal("unresolved") }),
]);

export type ResolveAwardInput = z.infer<typeof resolveInputSchema>;

export interface ResolveAwardActionResult {
  ok: boolean;
  message: string;
}

export async function resolveAwardAction(input: ResolveAwardInput): Promise<ResolveAwardActionResult> {
  const parsed = resolveInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid resolution request." };

  try {
    const repo = await getWriteRepo();
    const data = parsed.data;
    const result = await repo.resolveAward(
      data.awardId,
      data.resolution === "character"
        ? { kind: "character", characterId: data.characterId }
        : { kind: data.resolution },
    );
    if (!result.ok) return { ok: false, message: result.error };

    revalidatePath("/", "layout");
    const message =
      data.resolution === "character"
        ? "Award assigned — wishlist matching has been re-derived."
        : data.resolution === "external"
          ? "Marked off-roster."
          : "Moved back to unresolved.";
    return { ok: true, message };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Resolving failed." };
  }
}
