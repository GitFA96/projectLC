import {
  getDb,
  setGuildRoster,
  updateGuildRoster,
  deleteGuildRoster,
  setRaidBoard,
  setTemplateBoard,
  withTx,
} from "@/lib/data/db";
import type { WriteRepo } from "@/lib/data/repo";
import type { Writes } from "./model";

/**
 * The raid planner's boards: one per report, one template, and the saved
 * guild rosters an officer plans from.
 *
 * These are the writes that deliberately do **not** bump `data_version`. The
 * argument is on `setRaidBoard` below, and `write-contract.test.ts` asserts all
 * five in that direction rather than the usual one.
 */

export const plannerWrites = {
  /*
   * The board writes are the only ones here that deliberately do NOT call
   * bumpDataVersion, and the reason is worth stating because every neighbour
   * does (change-chains §4).
   *
   * That bump exists to rebuild the derived read model. Nothing derived reads a
   * board — every getter goes straight to the meta table, exactly like
   * consumable prices — so a bump would rebuild the whole model (every pull row
   * of every report) and change not one byte of the result. These boards
   * autosave as an officer drags people around, which turns that from waste
   * into lag.
   *
   * If a board ever starts feeding something derived, this stops being
   * true and the bump has to come back.
   */
  async setRaidBoard(code, board) {
    const db = getDb();
    withTx(db, () => setRaidBoard(db, code, board));
  },

  async setTemplateBoard(board) {
    const db = getDb();
    withTx(db, () => setTemplateBoard(db, board));
  },

  async createGuildRoster(board) {
    const db = getDb();
    withTx(db, () => setGuildRoster(db, board));
  },

  /* Read-modify-write, inside the transaction: three controls edit three
     different parts of one row. See updateGuildRoster in db/meta/guild-rosters.ts. */
  async updateGuildRoster(id, patch) {
    const db = getDb();
    withTx(db, () => updateGuildRoster(db, id, patch));
  },

  async deleteGuildRoster(id) {
    const db = getDb();
    withTx(db, () => deleteGuildRoster(db, id));
  },
} satisfies Partial<Writes> & ThisType<WriteRepo>;
