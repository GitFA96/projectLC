import { randomUUID } from "node:crypto";
import { bumpDataVersion, getDb, insertFeedback, withTx } from "@/lib/data/db";
import { feedbackReportSchema } from "@/lib/import/schemas";
import type { AddFeedbackResult, FeedbackDraft, PurgeDemoResult, WriteRepo } from "@/lib/data/repo";
import type { FeedbackReport, FeedbackStatus } from "@/lib/types";
import type { Writes } from "./model";

/**
 * What an operator does to the deployment rather than to a raid night:
 * feedback triage, and clearing the demo data out.
 *
 * `purgeDemoData` unlinks rather than deletes wherever a real row points at a
 * demo one — a real award resolved onto a seeded character reopens as
 * unresolved, and a real log keeps its rows with the character id cleared.
 * Deleting either would take a genuine raid night out with the demo.
 */

export const governanceWrites = {
  async addFeedback(draft: FeedbackDraft): Promise<AddFeedbackResult> {
    const parsed = feedbackReportSchema.safeParse({
      ...draft,
      // Resolved here rather than leaning on the schema default, so the
      // `satisfies` below still checks this object against the whole entity.
      kind: draft.kind ?? "bug",
      id: `fb_${randomUUID()}`,
      status: "open",
      // Filed, not yet triaged. Only an officer sets these.
      priority: "unset",
      adminNote: undefined,
      createdAt: new Date().toISOString(),
    } satisfies FeedbackReport);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid report." };
    }
    const db = getDb();
    withTx(db, () => {
      insertFeedback(db, parsed.data);
      bumpDataVersion(db);
    });
    return { ok: true, report: parsed.data };
  },

  async setFeedbackStatus(id: string, status: FeedbackStatus, by?: string): Promise<boolean> {
    const db = getDb();
    let changed = false;
    withTx(db, () => {
      // Closing signs the decision; reopening unsigns it. Both in one statement
      // so a report can never be resolved with no record of who resolved it.
      const resolving = status === "resolved";
      changed =
        Number(
          db
            .prepare("UPDATE feedback SET status = ?, resolved_by = ?, resolved_at = ? WHERE id = ?")
            .run(
              status,
              resolving ? by?.trim() || null : null,
              resolving ? new Date().toISOString() : null,
              id,
            ).changes,
        ) > 0;
      if (changed) bumpDataVersion(db);
    });
    return changed;
  },

  async setFeedbackTriage(id, triage) {
    // Built from the fields actually present: a caller setting only a priority
    // must not blank the note somebody else wrote in the same sitting.
    const sets: string[] = [];
    const values: (string | null)[] = [];
    if (triage.status !== undefined) {
      sets.push("status = ?");
      values.push(triage.status);
      // Same signing rule as setFeedbackStatus — triage is the other door to
      // closing a report, and a report closed through this one must not come out
      // unsigned. The author falls back to whoever signed the note in the same
      // call, since that is the person doing the triage.
      const resolving = triage.status === "resolved";
      sets.push("resolved_by = ?");
      values.push(resolving ? triage.resolvedBy?.trim() || triage.adminNoteAuthor?.trim() || null : null);
      sets.push("resolved_at = ?");
      values.push(resolving ? new Date().toISOString() : null);
    }
    if (triage.priority !== undefined) {
      sets.push("priority = ?");
      values.push(triage.priority);
    }
    if (triage.adminNote !== undefined) {
      const note = triage.adminNote.trim() || null;
      sets.push("admin_note = ?");
      values.push(note);
      // Author and time go with the note, and are cleared with it — a signature
      // left behind on a note somebody deleted attributes nothing to anybody.
      sets.push("admin_note_author = ?");
      values.push(note ? triage.adminNoteAuthor?.trim() || null : null);
      sets.push("admin_note_at = ?");
      values.push(note ? new Date().toISOString() : null);
    }
    if (sets.length === 0) return false;
    const db = getDb();
    let changed = false;
    withTx(db, () => {
      changed =
        Number(
          db
            .prepare(`UPDATE feedback SET ${sets.join(", ")} WHERE id = ?`)
            .run(...values, id).changes,
        ) > 0;
      if (changed) bumpDataVersion(db);
    });
    return changed;
  },

  async deleteFeedback(id: string): Promise<boolean> {
    const db = getDb();
    let deleted = false;
    withTx(db, () => {
      deleted = Number(db.prepare("DELETE FROM feedback WHERE id = ?").run(id).changes) > 0;
      if (deleted) bumpDataVersion(db);
    });
    return deleted;
  },

  async purgeDemoData(): Promise<PurgeDemoResult> {
    const db = getDb();
    // Seed-origin ids are recognizable: hyphenated prefixes (c-, rs-, la-) and
    // the SEED report code; everything created at runtime uses chr_/rs_/la_
    // UUID ids and real WCL codes. '%' after a literal hyphen is safe in LIKE.
    const removed: PurgeDemoResult = { characters: 0, raidSessions: 0, lootAwards: 0, gearSets: 0, wclReports: 0 };
    withTx(db, () => {
      // Seed WCL report (and its rows) go entirely.
      db.prepare("DELETE FROM wcl_player_fights WHERE report_code = 'SEEDsscProgress1'").run();
      db.prepare("DELETE FROM wcl_player_offpull WHERE report_code = 'SEEDsscProgress1'").run();
      removed.wclReports = Number(db.prepare("DELETE FROM wcl_reports WHERE code = 'SEEDsscProgress1'").run().changes);
      // Real reports/rows that point at demo rows get unlinked, never deleted.
      db.prepare("UPDATE wcl_player_fights SET character_id = NULL WHERE character_id LIKE 'c-%'").run();
      db.prepare("UPDATE wcl_player_offpull SET character_id = NULL WHERE character_id LIKE 'c-%'").run();
      db.prepare("UPDATE wcl_reports SET raid_session_id = NULL WHERE raid_session_id LIKE 'rs-%'").run();
      // Demo awards: the seeded ones and anything inside a demo session.
      removed.lootAwards = Number(
        db.prepare("DELETE FROM loot_awards WHERE id LIKE 'la-%' OR raid_session_id LIKE 'rs-%'").run().changes,
      );
      // Real awards manually resolved to a demo character reopen as unresolved.
      db.prepare("UPDATE loot_awards SET character_id = NULL, external = 0 WHERE character_id LIKE 'c-%'").run();
      // Gear sets follow their character — covers seeded sets and test imports onto demo characters.
      removed.gearSets = Number(db.prepare("DELETE FROM gear_sets WHERE character_id LIKE 'c-%'").run().changes);
      db.prepare("UPDATE item_comments SET character_id = NULL WHERE character_id LIKE 'c-%'").run();
      // Comments, exemptions and pinned slots on demo characters go too (they'd dangle otherwise).
      db.prepare("DELETE FROM character_comments WHERE character_id LIKE 'c-%'").run();
      db.prepare("DELETE FROM attendance_exemptions WHERE character_id LIKE 'c-%'").run();
      db.prepare("DELETE FROM current_gear_overrides WHERE character_id LIKE 'c-%'").run();
      removed.raidSessions = Number(db.prepare("DELETE FROM raid_sessions WHERE id LIKE 'rs-%'").run().changes);
      removed.characters = Number(db.prepare("DELETE FROM characters WHERE id LIKE 'c-%'").run().changes);
      bumpDataVersion(db);
    });
    return removed;
  },
} satisfies Partial<Writes> & ThisType<WriteRepo>;
