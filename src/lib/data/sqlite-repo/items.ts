import { randomUUID } from "node:crypto";
import {
  addEnchantNames,
  clearRefusedItemNames,
  recordRefusedItemNames,
  bumpDataVersion,
  getDb,
  insertItemComment,
  deleteItemComment,
  mergeItems,
  mergeTokenRedemptions,
  unverifyItem,
  withTx,
} from "@/lib/data/db";
import type { TokenRedemptionEdge } from "@/lib/items/tier-tokens";
import { harvestItemFacts } from "@/lib/items/item-data";
import { loadSeedStore } from "@/lib/data/seed-data";
import { itemCommentSchema, phaseSchema } from "@/lib/import/schemas";
import type { ItemCommentDraft, AddItemCommentResult, WriteRepo } from "@/lib/data/repo";
import type { ItemComment, Item, Phase } from "@/lib/types";
import { readModel } from "./model";
import type { Writes } from "./model";

/**
 * The item cache, its curation, and the comments filed against an item.
 *
 * Items arrive from Wowhead at import time and never during a render (root
 * AGENTS.md invariant 2), so everything here is either writing what an import
 * fetched or an officer correcting it. `recordRefusedItemNames` is the memory
 * of a lookup that failed: a name Wowhead has no id for is written down so the
 * next import does not ask again, and clearing it is how an officer says to.
 */

export const itemWrites = {
  async addItemsIfMissing(items: Item[]): Promise<number> {
    if (items.length === 0) return 0;
    const db = getDb();
    let learned = 0;
    withTx(db, () => {
      learned = mergeItems(db, items);
      if (learned > 0) bumpDataVersion(db);
    });
    return learned;
  },

  async saveResolvedItems(items: Item[]): Promise<number> {
    if (items.length === 0) return 0;
    const db = getDb();

    // Read before writing: the write stamps every row it is handed, so "did
    // this row change" is a question only the old values can answer. What the
    // officer wants counted is disagreement — the cache said one thing and the
    // authority said another — not the bookkeeping flip that always happens.
    const before = new Map(readModel().store.items.map((i) => [i.id, i]));
    const disagrees = (item: Item): boolean => {
      const prev = before.get(item.id);
      // An id the cache had never heard of was learned, not corrected.
      if (prev === undefined) return false;
      return (
        (item.name !== undefined && prev.name !== undefined && item.name !== prev.name) ||
        (item.quality !== undefined && prev.quality !== undefined && item.quality !== prev.quality) ||
        (item.icon !== undefined && prev.icon !== undefined && item.icon !== prev.icon) ||
        (item.slot !== undefined && prev.slot != null && item.slot !== prev.slot)
      );
    };
    const corrected = items.filter(disagrees).length;

    withTx(db, () => {
      mergeItems(db, items, { authoritative: true });
      // Always: even an unchanged row just became verified, and the read model
      // has to see that or the resolver keeps offering it up forever.
      bumpDataVersion(db);
    });
    return corrected;
  },

  async saveTokenRedemptions(edges: TokenRedemptionEdge[]): Promise<number> {
    if (edges.length === 0) return 0;
    const db = getDb();
    let written = 0;
    withTx(db, () => {
      written = mergeTokenRedemptions(db, edges);
      // Always, even when the page said what the cache already held: the read
      // model is what turns an edge into a satisfied wishlist row, and it only
      // reloads on the version counter.
      if (written > 0) bumpDataVersion(db);
    });
    return written;
  },

  async setItemCuration(
    itemId: number,
    curation: { phase: Phase | null; source: { zone: string; boss?: string } | null },
  ) {
    if (!Number.isInteger(itemId) || itemId <= 0) {
      return { ok: false as const, error: "That isn't an item id." };
    }
    const { phase, source } = curation;
    if (phase !== null && !phaseSchema.safeParse(phase).success) {
      return { ok: false as const, error: "That isn't a phase this app knows." };
    }
    if (source !== null && !source.zone.trim()) {
      return { ok: false as const, error: "Name the zone it drops in, or clear it." };
    }
    const sourceJson = source
      ? JSON.stringify({ zone: source.zone.trim(), ...(source.boss?.trim() ? { boss: source.boss.trim() } : {}) })
      : null;
    const db = getDb();
    withTx(db, () => {
      db.prepare(
        `INSERT INTO items (id, phase, source_json) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET phase = excluded.phase, source_json = excluded.source_json`,
      ).run(itemId, phase, sourceJson);
      // Phase feeds gem grading; zone is what the loot plan groups a raid by.
      bumpDataVersion(db);
    });
    return { ok: true as const };
  },

  async unverifyItem(itemId: number) {
    if (!Number.isInteger(itemId) || itemId <= 0) {
      return { ok: false as const, error: "That isn't an item id." };
    }
    const db = getDb();
    let changed = false;
    withTx(db, () => {
      changed = unverifyItem(db, itemId);
      // The resolver queue is derived, so the read model has to rebuild before
      // the next backfill press can see this row waiting in it.
      if (changed) bumpDataVersion(db);
    });
    return changed
      ? { ok: true as const }
      : { ok: false as const, error: "The cache has no row for that item." };
  },

  async applyCuratedItemSources(): Promise<number> {
    // Gap-filling merge: `source_json` and `phase` are COALESCEd onto rows that
    // have none, so this can be pressed repeatedly and can never overwrite an
    // officer's answer with the shipped one.
    return this.addItemsIfMissing(loadSeedStore().items);
  },

  async applySheetItemSources(): Promise<number> {
    // The read model has already done the judgement — matched sheet names to
    // cached rows and turned each section heading into a zone and boss — so
    // this is the same gap-filling merge as its neighbour, with a different
    // source of answers. `id` and `source` only: naming any other field here
    // would let a section heading fill in a name or an icon, which it has no
    // standing to do.
    const proposals = await readModel().repo.listSheetDropSources();
    return this.addItemsIfMissing(proposals.map(({ id, source }) => ({ id, source })));
  },

  async harvestItemCache(): Promise<number> {
    const { store } = readModel();
    return this.addItemsIfMissing(harvestItemFacts(store));
  },

  async recordRefusedItemNames(
    refused: { nameKey: string; name: string; reason: string; near: string[] }[],
  ): Promise<number> {
    if (refused.length === 0) return 0;
    const db = getDb();
    let written = 0;
    withTx(db, () => {
      written = recordRefusedItemNames(db, refused);
      // The lookup queues are part of the read model, and they filter on these.
      if (written > 0) bumpDataVersion(db);
    });
    return written;
  },

  async clearRefusedItemNames(nameKeys?: string[]): Promise<number> {
    const db = getDb();
    let removed = 0;
    withTx(db, () => {
      removed = clearRefusedItemNames(db, nameKeys);
      if (removed > 0) bumpDataVersion(db);
    });
    return removed;
  },

  async addEnchantNames(names: { id: number; name: string }[]): Promise<number> {
    if (names.length === 0) return 0;
    const db = getDb();
    let written = 0;
    withTx(db, () => {
      written = addEnchantNames(db, names);
      // The names are baked into the read model's enchant reference.
      if (written > 0) bumpDataVersion(db);
    });
    return written;
  },

  async addItemComment(draft: ItemCommentDraft): Promise<AddItemCommentResult> {
    // A comment can name a raider, and if it does, that raider has to exist —
    // an orphaned "2nd choice for someone" is worse than no note. The item
    // itself is deliberately NOT checked: officers discuss drops the cache
    // hasn't seen yet, and a note is how they record that.
    if (draft.characterId !== undefined && !readModel().store.roster.some((c) => c.id === draft.characterId)) {
      return { ok: false, error: "Character not found." };
    }
    const parsed = itemCommentSchema.safeParse({
      ...draft,
      id: `ic_${randomUUID()}`,
      createdAt: new Date().toISOString(),
    } satisfies ItemComment);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid comment." };
    }
    const db = getDb();
    withTx(db, () => {
      insertItemComment(db, parsed.data);
      bumpDataVersion(db);
    });
    return { ok: true, comment: parsed.data };
  },

  async deleteItemComment(id: string): Promise<boolean> {
    const db = getDb();
    let deleted = false;
    withTx(db, () => {
      deleted = deleteItemComment(db, id);
      if (deleted) bumpDataVersion(db);
    });
    return deleted;
  },
} satisfies Partial<Writes> & ThisType<WriteRepo>;
