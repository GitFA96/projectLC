"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getWriteRepo } from "@/lib/data/repo";

/**
 * Toggle one reset week as an excused absence for a character. Used by the
 * attendance card on the performance page — an excused week stops counting
 * toward the character's attendance markup (but stays visible as a gap).
 */
const schema = z.object({
  characterId: z.string().min(1),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid reset-week date."),
  excused: z.boolean(),
});

export async function setWeekExcused(input: {
  characterId: string;
  weekStart: string;
  excused: boolean;
}): Promise<{ ok: boolean; message?: string }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  try {
    const repo = await getWriteRepo();
    const result = await repo.setAttendanceExemption(
      parsed.data.characterId,
      parsed.data.weekStart,
      parsed.data.excused,
    );
    if (!result.ok) return { ok: false, message: result.error };
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Update failed." };
  }
}
