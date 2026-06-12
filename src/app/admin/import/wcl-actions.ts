"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getWriteRepo } from "@/lib/data/repo";
import { WclError, extractReportCode, hasWclCredentials } from "@/lib/wcl/client";
import { fetchWclReport } from "@/lib/wcl/fetch-report";

const importInputSchema = z.object({
  /** A report URL or bare report code. */
  report: z.string().min(1),
  /** Optional Gargul raid session to link the report to. */
  raidSessionId: z.string().optional(),
});
export type WclImportInput = z.infer<typeof importInputSchema>;

export type WclImportActionResult =
  | {
      status: "committed";
      code: string;
      title: string;
      zone?: string;
      replaced: boolean;
      fightCount: number;
      matched: string[];
      unmatched: string[];
      warnings: string[];
    }
  | { status: "not-configured" }
  | { status: "error"; message: string };

export async function importWclReport(input: WclImportInput): Promise<WclImportActionResult> {
  const parsed = importInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: "Invalid input — paste a Warcraft Logs report URL or code." };
  }
  if (!hasWclCredentials()) return { status: "not-configured" };

  const code = extractReportCode(parsed.data.report);
  if (!code) {
    return {
      status: "error",
      message: "Couldn't find a report code — paste the full report URL (…/reports/AbC123…) or just the code.",
    };
  }

  try {
    const normalized = await fetchWclReport(code);
    const repo = await getWriteRepo();
    const saved = await repo.saveWclReport(
      {
        code,
        title: normalized.title,
        zone: normalized.zone,
        startTime: normalized.startTime,
        endTime: normalized.endTime,
        raidSessionId: parsed.data.raidSessionId || null,
      },
      normalized.rows,
    );
    if (!saved.ok) return { status: "error", message: saved.error };

    revalidatePath("/", "layout");
    return {
      status: "committed",
      code: saved.report.code,
      title: saved.report.title,
      zone: saved.report.zone,
      replaced: saved.replaced,
      fightCount: saved.fightCount,
      matched: saved.matched,
      unmatched: saved.unmatched,
      warnings: normalized.warnings,
    };
  } catch (e) {
    if (e instanceof WclError) return { status: "error", message: e.message };
    return {
      status: "error",
      message: `Import failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
