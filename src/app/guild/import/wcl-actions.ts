"use server";

import { z } from "zod";
import { getWriteRepo } from "@/lib/data/repo";
import { refreshAfterWrite } from "@/lib/refresh";
import { can, requireCapability } from "@/lib/auth/can";
import { resolveViewer } from "@/lib/auth/viewer";
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
    requireCapability(await resolveViewer(), "import.run");
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

/**
 * Re-fetch a report that's already imported, keeping everything an officer
 * curated about it.
 *
 * Everything a report can show is fixed at import time — tracked consumables,
 * class auras, talents, gear detail — so gaining anything added since means
 * fetching it again. The code is already stored, so nothing needs pasting.
 *
 * The catch is metadata. A plain import defaults the title and zone to whatever
 * Warcraft Logs says and the session link to null, so re-running it would erase
 * a rename, a corrected raid label ("SSC/TK" over WCL's multi-zone guess) and
 * the Gargul session the night is linked to — quietly, and with no way back
 * short of redoing it by hand. So the stored values are read first and passed
 * back in.
 *
 * The pull data itself needs no protection: saveWclReport deletes the old rows
 * and replaces the report wholesale, which is the existing update flow.
 */
export async function refetchWclReport(input: { code: string }): Promise<WclImportActionResult> {
  const parsed = deleteInputSchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: "Invalid report code." };

  // No try block to land a throw in, and this reads the report list before it
  // delegates — so ask, and answer in the shape this file already returns.
  if (!can(await resolveViewer(), "import.run")) {
    return { status: "error", message: "You don't have permission to do that." };
  }

  const repo = await getWriteRepo();
  const existing = (await repo.listWclReports()).find((r) => r.report.code === parsed.data.code);
  if (!existing) {
    return { status: "error", message: "That report isn't imported — paste its URL to import it." };
  }

  return importWclReport({
    report: existing.report.code,
    title: existing.report.title,
    zone: existing.report.zone,
    raidSessionId: existing.report.raidSessionId ?? undefined,
  });
}

const deleteManySchema = z.object({ codes: z.array(z.string().min(1)).min(1) });

/**
 * Remove several reports at once — the checkbox flow on the imported list.
 *
 * Each delete stands alone: one failure doesn't roll back the ones that already
 * succeeded, and the caller is told exactly which codes failed. A partial
 * result is honest here; pretending the whole batch failed would send the
 * officer looking for reports that are already gone.
 */
export async function deleteWclReportsAction(input: {
  codes: string[];
}): Promise<{ ok: boolean; message: string; deleted: string[]; failed: string[] }> {
  const parsed = deleteManySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "No reports selected.", deleted: [], failed: [] };

  const deleted: string[] = [];
  const failed: string[] = [];
  let rowsRemoved = 0;
  try {
    requireCapability(await resolveViewer(), "import.run");
    const repo = await getWriteRepo();
    for (const code of parsed.data.codes) {
      try {
        const result = await repo.deleteWclReport(code);
        if (result.ok) {
          deleted.push(code);
          rowsRemoved += result.rowsRemoved;
        } else failed.push(code);
      } catch {
        failed.push(code);
      }
    }
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Delete failed.",
      deleted,
      failed: [...failed, ...parsed.data.codes.filter((c) => !deleted.includes(c) && !failed.includes(c))],
    };
  }

  // Refresh once for the whole batch rather than once per report.
  if (deleted.length > 0) refreshAfterWrite("/", "layout");
  const plural = deleted.length === 1 ? "report" : "reports";
  return {
    ok: failed.length === 0,
    message:
      failed.length === 0
        ? `Removed ${deleted.length} ${plural} (${rowsRemoved} player-pull rows).`
        : `Removed ${deleted.length} ${plural}; ${failed.length} could not be deleted (${failed.join(", ")}).`,
    deleted,
    failed,
  };
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
    requireCapability(await resolveViewer(), "import.run");
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

/**
 * How many pulls an unknown aura has to appear at before it files itself.
 *
 * Not in `policy.ts`: that holds the numbers where changing one changes a loot
 * verdict, and this one only decides whether the app writes itself a note. One
 * sighting is usually a world buff or somebody's trinket proc; a consumable the
 * raid actually runs shows up repeatedly, which is what makes it worth curating.
 */
const AURA_FLAG_MIN_PULLS = 5;

/**
 * File the unknown auras an import met, so a blind spot outlives the tab.
 *
 * The dump has always been shown on the import screen and never kept, so a
 * finding survived exactly as long as the officer left the page open — which is
 * how eleven pulls of an uncounted flask sat there for weeks. The app knows it
 * failed to understand something; saying so in the same place raiders file bugs
 * is the honest version of that.
 *
 * **Deduped by ability id against every existing report**, open or resolved: the
 * same aura turns up every raid night, and a tool that files a fresh copy weekly
 * teaches officers to ignore it. Never throws — the import is already committed
 * by the time this runs, and losing a night's data over a self-addressed note
 * would be a bad trade.
 */
async function flagUnknownAuras(
  repo: Awaited<ReturnType<typeof getWriteRepo>>,
  code: string,
  auras: UnclassifiedAura[],
): Promise<void> {
  try {
    const worth = auras.filter((a) => a.count >= AURA_FLAG_MIN_PULLS && a.abilityId !== undefined);
    if (worth.length === 0) return;

    const existing = await repo.listFeedback();
    const alreadyFiled = (aura: UnclassifiedAura) =>
      existing.some((r) => r.body.includes(`#${aura.abilityId} `) || r.body.includes(`(${aura.abilityId})`));
    const fresh = worth.filter((a) => !alreadyFiled(a));
    if (fresh.length === 0) return;

    const lines = fresh.map((a) => `- #${a.abilityId} “${a.name}” — at ${a.count} pulls`);
    await repo.addFeedback({
      kind: "feedback",
      reporter: "Import",
      body: [
        `${fresh.length} aura${fresh.length === 1 ? "" : "s"} at boss pulls that the consumable tables don't recognise:`,
        "",
        ...lines,
        "",
        "If any is a consumable, curating it in src/lib/wcl/consumables.ts makes it",
        "count — and the reports that already saw it need re-importing before it shows.",
      ].join("\n"),
      route: "/guild/import",
      url: `/guild/import?report=${code}`,
    });
  } catch {
    // Deliberately silent: see above.
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
    requireCapability(await resolveViewer(), "import.run");
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
        unclassifiedAuras: normalized.unclassifiedAuras,
      },
      normalized.rows,
      normalized.offPull,
    );
    if (!saved.ok) return { status: "error", message: saved.error };

    // The import is already committed, so a failure to file the report below
    // must not fail the import — it is a note to ourselves, not the work.
    await flagUnknownAuras(repo, saved.report.code, normalized.unclassifiedAuras);

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
