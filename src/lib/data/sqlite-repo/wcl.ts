import {
  bumpDataVersion,
  getDb,
  setReportConsumableAdjustments,
  insertWclPlayerFight,
  insertWclPlayerOffPull,
  insertWclReport,
  mergeItems,
  setReportConsumablePrices,
  setReportPayback,
  setSimProfile,
  addAbilities,
  setReportExcludedFights,
  withTx,
} from "@/lib/data/db";
import { harvestItemFacts } from "@/lib/items/item-data";
import { TRACKED_AURA_NAMES } from "@/lib/wcl/class-tracks";
import {
  wclPlayerFightSchema,
  wclPlayerOffPullSchema,
  wclReportSchema,
} from "@/lib/import/schemas";
import type {
  WclPlayerFightDraft,
  WclPlayerOffPullDraft,
  WclReportDraft,
  WclSaveResult,
  WriteRepo,
} from "@/lib/data/repo";
import type { WclPlayerFight, WclPlayerOffPull } from "@/lib/types";
import { readModel, characterByName } from "./model";
import type { Writes } from "./model";

/**
 * Warcraft Logs reports and everything else keyed by a report code.
 *
 * `saveWclReport` is the only writer that matches log names to the roster, and
 * it matches by name because a name is all a log carries. One it cannot place
 * comes back in `unmatched` and the row is stored with a null character rather
 * than guessed at — the report page shows the untracked player, where a
 * wrongly-linked one would silently change a raider's attendance.
 *
 * A curated consumable or aura id added after a report was imported collects
 * nothing from it, ever: the events fetch is filtered server-side, so the rows
 * written here are all that log will ever yield (change-chains §1).
 */

export const wclWrites = {
  async saveWclReport(
    reportDraft: WclReportDraft,
    rowDrafts: WclPlayerFightDraft[],
    offPullDrafts: WclPlayerOffPullDraft[] = [],
  ): Promise<WclSaveResult> {
    const model = readModel();
    if (reportDraft.raidSessionId && !model.store.raidSessions.some((s) => s.id === reportDraft.raidSessionId)) {
      return { ok: false, error: "The selected raid session no longer exists." };
    }
    if (rowDrafts.length === 0) {
      return { ok: false, error: "The report has no per-player boss data to import." };
    }

    const parsedReport = wclReportSchema.safeParse({
      ...reportDraft,
      fetchedAt: new Date().toISOString(),
      /*
       * Stamped here rather than by the fetcher: this is the one place every
       * import and refetch passes through, so the record can't drift from what
       * was actually stored. It's what lets a later reader tell "the raid never
       * had Blood Frenzy" from "this report predates the Blood Frenzy track".
       */
      upkeepTracks: TRACKED_AURA_NAMES,
      raidSessionId: reportDraft.raidSessionId ?? null,
    });
    if (!parsedReport.success) {
      return { ok: false, error: parsedReport.error.issues[0]?.message ?? "Invalid report." };
    }
    const report = parsedReport.data;

    const matched = new Set<string>();
    const unmatched = new Set<string>();
    const rows: WclPlayerFight[] = rowDrafts.map((draft) => {
      const character = characterByName(draft.actorName);
      (character ? matched : unmatched).add(draft.actorName);
      return wclPlayerFightSchema.parse({
        ...draft,
        id: `${report.code}:${draft.fightId}:${draft.actorName.toLowerCase()}`,
        reportCode: report.code,
        characterId: character?.id ?? null,
      } satisfies WclPlayerFight);
    });

    // Same name matching as the pulls, so a raider's trash potions land on the
    // same character their boss pulls did.
    const offPull = offPullDrafts.map((draft) =>
      wclPlayerOffPullSchema.parse({
        ...draft,
        id: `${report.code}:${draft.actorName.toLowerCase()}`,
        reportCode: report.code,
        characterId: characterByName(draft.actorName)?.id ?? null,
      } satisfies WclPlayerOffPull),
    );

    const db = getDb();
    const existed = model.store.wclReports.some((r) => r.code === report.code);
    withTx(db, () => {
      db.prepare("DELETE FROM wcl_player_fights WHERE report_code = ?").run(report.code);
      db.prepare("DELETE FROM wcl_player_offpull WHERE report_code = ?").run(report.code);
      insertWclReport(db, report); // INSERT OR REPLACE keyed on code
      for (const row of rows) insertWclPlayerFight(db, row);
      for (const off of offPull) insertWclPlayerOffPull(db, off);
      // Every logged pull carries a gear snapshot with icons (and sometimes
      // names) — the cheapest item data there is, so it lands in the cache
      // instead of staying buried in per-row JSON.
      mergeItems(db, harvestItemFacts({ gearSets: [], lootAwards: [], wclPlayerFights: rows }));
      bumpDataVersion(db);
    });
    return {
      ok: true,
      report,
      replaced: existed,
      fightCount: new Set(rows.map((r) => r.fightId)).size,
      matched: [...matched].sort(),
      unmatched: [...unmatched].sort(),
    };
  },

  async updateWclReportMeta(code: string, meta: { title?: string; zone?: string }) {
    if (!readModel().store.wclReports.some((r) => r.code === code)) {
      return { ok: false as const, error: "Report not found — maybe removed." };
    }
    const title = meta.title?.trim();
    const zone = meta.zone?.trim();
    const db = getDb();
    withTx(db, () => {
      if (title) db.prepare("UPDATE wcl_reports SET title = ? WHERE code = ?").run(title, code);
      if (meta.zone !== undefined) {
        db.prepare("UPDATE wcl_reports SET zone = ? WHERE code = ?").run(zone || null, code);
      }
      bumpDataVersion(db);
    });
    return { ok: true as const };
  },

  async deleteWclReport(code: string) {
    const exists = readModel().store.wclReports.some((r) => r.code === code);
    if (!exists) return { ok: false as const, error: "Report not found — maybe already removed." };
    const db = getDb();
    let rowsRemoved = 0;
    withTx(db, () => {
      rowsRemoved = Number(db.prepare("DELETE FROM wcl_player_fights WHERE report_code = ?").run(code).changes);
      db.prepare("DELETE FROM wcl_player_offpull WHERE report_code = ?").run(code);
      db.prepare("DELETE FROM wcl_reports WHERE code = ?").run(code);
      bumpDataVersion(db);
    });
    return { ok: true as const, rowsRemoved };
  },

  async setReportConsumablePrices(code, prices) {
    const db = getDb();
    withTx(db, () => {
      setReportConsumablePrices(db, code, prices);
      bumpDataVersion(db);
    });
  },

  async setReportPayback(code, payback) {
    const db = getDb();
    withTx(db, () => {
      setReportPayback(db, code, payback);
      bumpDataVersion(db);
    });
  },

  async setReportExcludedFights(code, fightIds) {
    const db = getDb();
    withTx(db, () => {
      setReportExcludedFights(db, code, fightIds);
      // The read model bakes the filter in — the bump forces it to rebuild.
      bumpDataVersion(db);
    });
  },

  async setReportConsumableAdjustments(code, adjustments) {
    const db = getDb();
    withTx(db, () => {
      setReportConsumableAdjustments(db, code, adjustments);
      // Career gold reads these, and it's baked into the model.
      bumpDataVersion(db);
    });
  },

  async addAbilities(abilities) {
    const db = getDb();
    let written = 0;
    withTx(db, () => {
      written = addAbilities(db, abilities);
      if (written > 0) bumpDataVersion(db);
    });
    return written;
  },

  async setSimProfile(wowClass, spec, json) {
    const db = getDb();
    withTx(db, () => {
      setSimProfile(db, wowClass, spec, json);
      bumpDataVersion(db);
    });
  },
} satisfies Partial<Writes> & ThisType<WriteRepo>;
