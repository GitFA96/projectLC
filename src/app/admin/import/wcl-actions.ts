"use server";

import { z } from "zod";
import { getWriteRepo } from "@/lib/data/repo";
import { refreshAfterWrite } from "@/lib/refresh";
import { WclError, extractReportCode, hasWclCredentials } from "@/lib/wcl/client";
import { fetchWclReport } from "@/lib/wcl/fetch-report";
import type { IgnoredCombatantInfo, UnclassifiedAura } from "@/lib/wcl/normalize";

const importInputSchema = z.object({
  /** A report URL or bare report code. */
  report: z.string().min(1),
  /** Optional Gargul raid session to link the report to. */
  raidSessionId: z.string().optional(),
  /** Optional display overrides — WCL titles/zones are often wrong for multi-zone nights. */
  title: z.string().optional(),
  zone: z.string().optional(),
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
      /** Combatant-info events outside boss pulls (trash), inspectable in the UI. */
      ignored: { total: number; players: number; sample: IgnoredCombatantInfo[] };
      /** Aura names at pulls the consumable tables didn't recognize — the curation dump. */
      auraDump: UnclassifiedAura[];
    }
  | { status: "not-configured" }
  | { status: "error"; message: string };

const deleteInputSchema = z.object({ code: z.string().min(1) });

/** Remove a wrongfully imported report (and all its per-player rows). */
export async function deleteWclReportAction(input: { code: string }): Promise<{ ok: boolean; message: string }> {
  const parsed = deleteInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid report code." };
  try {
    const repo = await getWriteRepo();
    const result = await repo.deleteWclReport(parsed.data.code);
    if (!result.ok) return { ok: false, message: result.error };
    refreshAfterWrite("/", "layout");
    return {
      ok: true,
      message: `Report removed (${result.rowsRemoved} player-pull rows). Attendance and performance pages updated.`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Delete failed." };
  }
}

const updateMetaSchema = z.object({
  code: z.string().min(1),
  title: z.string().min(1, "The title can't be empty."),
  /** Empty string clears the zone label. */
  zone: z.string(),
});

/** Rename an imported report / relabel its raid ("Gruul / Magtheridon" → "SSC/TK"). */
export async function updateWclReportMetaAction(input: {
  code: string;
  title: string;
  zone: string;
}): Promise<{ ok: boolean; message: string }> {
  const parsed = updateMetaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    const repo = await getWriteRepo();
    const result = await repo.updateWclReportMeta(parsed.data.code, {
      title: parsed.data.title,
      zone: parsed.data.zone,
    });
    if (!result.ok) return { ok: false, message: result.error };
    refreshAfterWrite("/", "layout");
    return { ok: true, message: "Report updated." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Update failed." };
  }
}

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
        title: parsed.data.title?.trim() || normalized.title,
        zone: parsed.data.zone?.trim() || normalized.zone,
        startTime: normalized.startTime,
        endTime: normalized.endTime,
        raidSessionId: parsed.data.raidSessionId || null,
      },
      normalized.rows,
      normalized.offPull,
    );
    if (!saved.ok) return { status: "error", message: saved.error };

    refreshAfterWrite("/", "layout");
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
      ignored: normalized.ignoredCombatantInfo,
      auraDump: normalized.unclassifiedAuras,
    };
  } catch (e) {
    if (e instanceof WclError) return { status: "error", message: e.message };
    return {
      status: "error",
      message: `Import failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
