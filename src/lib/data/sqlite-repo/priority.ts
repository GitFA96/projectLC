import {
  bumpDataVersion,
  deleteItemPriorityRule,
  getDb,
  getItemPriorityRuleAt,
  setSheetItemId,
  getWishlistAlternatives,
  setWishlistAlternative,
  deleteWishlistAlternative,
  setPrioritySheet,
  deletePrioritySheet,
  mergeItems,
  moveItemPriorityRule,
  setItemPriorityRule,
  withTx,
} from "@/lib/data/db";
import { normalizeItemName, parsePrioritySheet } from "@/lib/loot/priority-sheet";
import { parsePriorityChain } from "@/lib/loot/priority-chain";
import { PHASE_IDS } from "@/lib/constants/wow";
import { renumber } from "@/lib/analysis/wishlist-alternatives";
import type { WriteRepo } from "@/lib/data/repo";
import type { Phase } from "@/lib/types";
import { readModel } from "./model";
import type { Writes } from "./model";

/**
 * Loot priority as the officers write it: the per-item chains, the pasted
 * priority sheets, and the wishlist alternatives.
 *
 * These are the guild's judgements, not the app's. They are written here and
 * applied in `src/lib/analysis`, which never learns where they came from.
 * `moveItemPriorityRule` is the one to read: a chain is keyed by phase as well
 * as name, so moving one is a single repo call rather than a write plus a clear
 * — the halves failing apart would duplicate or lose a ruling — and it refuses
 * when the target phase already has a chain, because that is a second ruling
 * somebody made (change-chains §4h).
 */

export const priorityWrites = {
  async moveItemPriorityRule(input: { itemName: string; fromPhase: number; toPhase: number }) {
    const { itemName, fromPhase, toPhase } = input;
    const key = normalizeItemName(itemName.trim());
    if (!key) return { ok: false as const, error: "That item name has nothing to match on." };
    if (!PHASE_IDS.includes(toPhase as Phase)) {
      return { ok: false as const, error: `Phase ${toPhase} isn't a phase this guild raids.` };
    }
    if (fromPhase === toPhase) return { ok: true as const };

    const db = getDb();
    if (!getItemPriorityRuleAt(db, key, fromPhase)) {
      return { ok: false as const, error: `No chain filed under phase ${fromPhase} for that item.` };
    }
    // Refuse rather than overwrite: a chain already filed against the target is
    // a separate ruling, and this button must never be how one disappears.
    if (getItemPriorityRuleAt(db, key, toPhase)) {
      return {
        ok: false as const,
        error: `The phase ${toPhase} sheet already has a chain for that item — clear it there first.`,
      };
    }
    withTx(db, () => {
      moveItemPriorityRule(db, key, fromPhase, toPhase);
      bumpDataVersion(db);
    });
    return { ok: true as const };
  },

  async setItemPriorityRule(input: { itemName: string; phase: number; chain: string; note?: string }) {
    const { itemName, phase, chain, note } = input;
    const name = itemName.trim();
    if (!name) return { ok: false as const, error: "An item name is required." };
    const key = normalizeItemName(name);
    if (!key) return { ok: false as const, error: "That item name has nothing to match on." };
    if (!PHASE_IDS.includes(phase as Phase)) {
      return { ok: false as const, error: `Phase ${phase} isn't a phase this guild raids.` };
    }

    const db = getDb();
    const trimmed = chain.trim();
    // An empty chain is how an officer says "use the guild's sheet again" — for
    // this phase. Another phase's chain for the same item is a separate ruling.
    if (!trimmed) {
      withTx(db, () => {
        if (deleteItemPriorityRule(db, key, phase)) bumpDataVersion(db);
      });
      return { ok: true as const };
    }

    const parsed = parsePriorityChain(trimmed);
    if (parsed.tiers.length === 0) {
      return { ok: false as const, error: "Write the chain as “Hunter > DPS Warrior > MS > OS”." };
    }
    withTx(db, () => {
      setItemPriorityRule(db, key, phase, { itemName: name, chain: trimmed, note: note?.trim() || undefined });
      bumpDataVersion(db);
    });
    return {
      ok: true as const,
      rule: {
        itemName: name,
        chain: trimmed,
        tiers: parsed.tiers,
        note: note?.trim() || undefined,
        origin: "officer" as const,
        phase,
      },
    };
  },

  async setPrioritySheet(input: { phase: number; markdown: string; author?: string; note?: string }) {
    if (!PHASE_IDS.includes(input.phase as (typeof PHASE_IDS)[number])) {
      return { ok: false as const, error: `Phase ${input.phase} isn't a phase this app knows.` };
    }
    const markdown = input.markdown.trim();
    if (!markdown) {
      return { ok: false as const, error: "Paste the sheet's markdown, or reset the phase instead." };
    }
    // Parse before storing: a sheet that yields no rows is a paste that went
    // wrong (the wrong half of a document, a table without its pipes), and
    // storing it would replace a working sheet with silence.
    const rules = parsePrioritySheet(markdown);
    if (rules.length === 0) {
      return {
        ok: false as const,
        error:
          "Nothing in that text parses as a priority row. Rows need to look like " +
          "“| Item | Priority | Slot | Notes |”, under a ### heading for the boss.",
      };
    }
    const db = getDb();
    withTx(db, () => {
      setPrioritySheet(db, input.phase, {
        markdown,
        author: input.author?.trim() || undefined,
        note: input.note?.trim() || undefined,
      });
      // The sheet feeds every contested item's ranking through the read model.
      bumpDataVersion(db);
    });
    return { ok: true as const, ruleCount: rules.length };
  },

  async deletePrioritySheet(phase: number) {
    const db = getDb();
    withTx(db, () => {
      if (deletePrioritySheet(db, phase)) bumpDataVersion(db);
    });
    return { ok: true as const };
  },

  async setWishlistAlternatives(input: {
    characterId: string;
    phase: number;
    slot: string;
    items: { itemId: number; itemName?: string; note?: string }[];
  }) {
    if (!readModel().store.roster.some((c) => c.id === input.characterId)) {
      return { ok: false as const, error: "That character no longer exists." };
    }
    if (!PHASE_IDS.includes(input.phase as (typeof PHASE_IDS)[number])) {
      return { ok: false as const, error: `Phase ${input.phase} isn't a phase this app knows.` };
    }
    const items = input.items.filter((i) => Number.isInteger(i.itemId) && i.itemId > 0);
    // The same item twice would give one slot two different ranks for it.
    const seen = new Set<number>();
    const unique = items.filter((i) => !seen.has(i.itemId) && seen.add(i.itemId));

    const db = getDb();
    withTx(db, () => {
      // Replace outright: the caller sends the whole list in order, so anything
      // no longer in it was removed. Renumbering keeps ranks dense — a gap
      // would make "2nd choice" mean nothing.
      for (const existing of getWishlistAlternatives(db)) {
        if (
          existing.characterId === input.characterId &&
          existing.phase === input.phase &&
          existing.slot === input.slot &&
          !unique.some((i) => i.itemId === existing.itemId)
        ) {
          deleteWishlistAlternative(db, input.characterId, input.phase, input.slot, existing.itemId);
        }
      }
      renumber(unique).forEach(({ itemId, rank }) => {
        const item = unique.find((i) => i.itemId === itemId)!;
        setWishlistAlternative(db, {
          characterId: input.characterId,
          phase: input.phase,
          slot: input.slot,
          itemId,
          itemName: item.itemName,
          rank,
          note: item.note,
        });
      });
      bumpDataVersion(db);
    });
    return { ok: true as const };
  },

  async setSheetItemId(itemName, itemId) {
    const key = normalizeItemName(itemName);
    if (!key) return { ok: false as const, error: "That name is empty." };
    const db = getDb();
    withTx(db, () => {
      setSheetItemId(db, key, itemId);
      // A pinned id the cache has never seen would render as nothing at all.
      // Seeding a bare row puts it in front of the item resolver, which fills
      // in the name and icon on the next backfill.
      if (itemId !== undefined) mergeItems(db, [{ id: itemId }]);
      bumpDataVersion(db);
    });
    return { ok: true as const };
  },
} satisfies Partial<Writes> & ThisType<WriteRepo>;
