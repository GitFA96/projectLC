import { randomUUID } from "node:crypto";
import {
  bumpDataVersion,
  getDb,
  insertBossComment,
  deleteBossComment,
  upsertBossDrops,
  deleteBossDrop,
  upsertGuildBossDrop,
  deleteGuildBossDrop,
  withTx,
} from "@/lib/data/db";
import type { BossDropDraft } from "@/lib/loot/drop-table";
import { normalizeItemName } from "@/lib/loot/priority-sheet";
import { bossKey } from "@/lib/constants/wow";
import { bossCommentSchema, bossDropSchema, guildBossDropSchema } from "@/lib/import/schemas";
import type { WriteRepo } from "@/lib/data/repo";
import type { BossComment, BossDrop, GuildBossDrop } from "@/lib/types";
import { readModel } from "./model";
import type { Writes } from "./model";

/**
 * What drops where, and what this guild says about it.
 *
 * Two layers, and reading the wrong one changes another council's verdict:
 * `boss_drops` is foundational and shared across the deployment, while a guild
 * disagreeing with it writes a `guild_boss_drops` row over the top. Verdict
 * paths read the merged view, never the shared table underneath — see
 * `docs/shared-and-guild-data.md` before adding to either.
 */

export const dropWrites = {
  async upsertBossDrops(drafts: BossDropDraft[]): Promise<number> {
    if (drafts.length === 0) return 0;
    const now = new Date().toISOString();
    // Normalization happens once, here, on the way in. Every reader then
    // compares stored keys directly — see the note on `rowKey` in drop-table.ts
    // for why a second normalizer is the thing to avoid.
    const rows = drafts.flatMap((d) => {
      const parsed = bossDropSchema.safeParse({
        zone: d.zone.trim(),
        bossKey: bossKey(d.boss),
        boss: d.boss.trim(),
        itemKey: normalizeItemName(d.itemName),
        itemName: d.itemName.trim(),
        itemId: d.itemId,
        slotLabel: d.slotLabel?.trim() || undefined,
        note: d.note?.trim() || undefined,
        author: d.author?.trim() || undefined,
        updatedAt: now,
      } satisfies BossDrop);
      return parsed.success ? [parsed.data] : [];
    });
    const db = getDb();
    let written = 0;
    withTx(db, () => {
      written = upsertBossDrops(db, rows);
      // The drop table feeds the loot plan, so a write nobody rebuilds for is a
      // write that stays invisible until restart.
      if (written > 0) bumpDataVersion(db);
    });
    return written;
  },

  async deleteBossDrop(zone: string, boss: string, itemName: string): Promise<boolean> {
    const db = getDb();
    let deleted = false;
    withTx(db, () => {
      deleted = deleteBossDrop(db, zone, bossKey(boss), normalizeItemName(itemName));
      if (deleted) bumpDataVersion(db);
    });
    return deleted;
  },

  async seedFoundationalDrops(): Promise<{
    fromSheets: number;
    fromCache: number;
    deduped: number;
  }> {
    // The read model does the gathering and the parsing; this only writes.
    const { drafts, fromSheets, fromCache } = await readModel().repo.listKnownDropSources();
    await this.upsertBossDrops(drafts);

    // Then clear any row listing one item twice under one boss. An earlier
    // version of the gather keyed only on the written name, so the sheet's
    // spelling and the item's own spelling each produced a row; the table's key
    // is that name, so an upsert can never collapse them afterwards.
    const doomed = await readModel().repo.listDuplicateDrops();
    let deduped = 0;
    for (const row of doomed) {
      if (await this.deleteBossDrop(row.zone, row.boss, row.itemName)) deduped += 1;
    }
    return { fromSheets, fromCache, deduped };
  },

  async setGuildDropOverride(input: {
    zone: string;
    boss: string;
    itemName: string;
    itemId?: number;
    action: "add" | "hide";
    note?: string;
    author?: string;
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    const parsed = guildBossDropSchema.safeParse({
      guildId: readModel().store.guild.id,
      zone: input.zone.trim(),
      bossKey: bossKey(input.boss),
      boss: input.boss.trim(),
      itemKey: normalizeItemName(input.itemName),
      itemName: input.itemName.trim(),
      itemId: input.itemId,
      action: input.action,
      note: input.note?.trim() || undefined,
      author: input.author?.trim() || undefined,
      updatedAt: new Date().toISOString(),
    } satisfies GuildBossDrop);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid override." };
    }
    const db = getDb();
    withTx(db, () => {
      upsertGuildBossDrop(db, parsed.data);
      bumpDataVersion(db);
    });
    return { ok: true };
  },

  async clearGuildDropOverride(zone: string, boss: string, itemName: string): Promise<boolean> {
    const db = getDb();
    let deleted = false;
    withTx(db, () => {
      deleted = deleteGuildBossDrop(
        db, readModel().store.guild.id, zone, bossKey(boss), normalizeItemName(itemName),
      );
      if (deleted) bumpDataVersion(db);
    });
    return deleted;
  },

  async addBossComment(input: {
    zone: string;
    boss: string;
    body: string;
    author?: string;
  }): Promise<{ ok: true; comment: BossComment } | { ok: false; error: string }> {
    // The boss is deliberately NOT checked against the raid table. Officers
    // write notes about drop sources the table has never named — a rare spawn,
    // a trash pack worth stopping for — and the same reasoning applies as to an
    // item comment on a drop the cache has not seen: a note is how that gets
    // recorded, not something to refuse until the table catches up.
    const parsed = bossCommentSchema.safeParse({
      zone: input.zone.trim(),
      // Stored both ways on purpose: the key is what a reader looks up by, the
      // label is what they recognise. See the table comment in db/schema.ts.
      bossKey: bossKey(input.boss),
      boss: input.boss.trim(),
      body: input.body.trim(),
      author: input.author?.trim() || undefined,
      id: `bc_${randomUUID()}`,
      createdAt: new Date().toISOString(),
    } satisfies BossComment);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid note." };
    }
    const db = getDb();
    withTx(db, () => {
      insertBossComment(db, parsed.data);
      bumpDataVersion(db);
    });
    return { ok: true, comment: parsed.data };
  },

  async deleteBossComment(id: string): Promise<boolean> {
    const db = getDb();
    let deleted = false;
    withTx(db, () => {
      deleted = deleteBossComment(db, id);
      if (deleted) bumpDataVersion(db);
    });
    return deleted;
  },
} satisfies Partial<Writes> & ThisType<WriteRepo>;
