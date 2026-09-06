import {
  mergeDropTable,
  resolveDropNames,
  type BossDropDraft,
  type MergedDrop,
} from "@/lib/loot/drop-table";
import { normalizeItemName } from "@/lib/loot/priority-sheet";
import { sheetSectionSource } from "@/lib/loot/sheet-sources";
import { PHASE_IDS, bossKey } from "@/lib/constants/wow";
import type { BossComment, BossDrop, GuildBossDrop } from "@/lib/types";
import type { Repo } from "@/lib/data/repo";
import { compareText } from "@/lib/sort";
import type { StoreContext } from "./context";

/**
 * What drops where, merged from two layers.
 *
 * `boss_drops` is foundational and shared across the deployment; a guild that
 * disagrees writes a `guild_boss_drops` row over the top. Every verdict path
 * reads the merged view and never the shared table underneath — see
 * `docs/shared-and-guild-data.md`, and note that the guild's `hide` has to be
 * applied to sources that never came from the table at all.
 */

export function dropViews(ctx: StoreContext) {
  const { config, bossCommentsByBoss, bossDrops, guild, guildBossDrops, items, itemsById, rulesForPhase, sheetItemIdFor } = ctx;
  return {
    /**
     * The drop table this guild reads for one zone: the foundational one with
     * their own additions and removals laid over it.
     *
     * The overlay is filtered to THIS guild here rather than in the merge, so
     * the pure layer never has to know which guild is asking — and so a bug in
     * the filter is a bug in one place rather than in every caller.
     */
    async getDropTable(zone: string): Promise<MergedDrop[]> {
      const target = zone.toLowerCase();
      const merged = mergeDropTable(
        bossDrops.filter((d) => d.zone.toLowerCase() === target),
        guildBossDrops.filter((d) => d.guildId === guild.id && d.zone.toLowerCase() === target),
      );
      // The drop table records how a drop was WRITTEN; the item cache is what
      // it is CALLED. Reading the name back off the item is what stops the two
      // being a second copy that can rot — a Wowhead correction reaches the
      // plan, the boss page and the sheet at once, without anybody retyping.
      return resolveDropNames(merged, (id) => {
        const item = itemsById.get(id);
        return item && { name: item.name, quality: item.quality, icon: item.icon };
      });
    },

    /**
     * Everything this deployment already knows about which boss drops what,
     * gathered as drafts for the foundational table.
     *
     * Two sources, in this order:
     *
     *   1. **Every priority sheet's boss sections.** This is where Mount Hyjal
     *      and Black Temple come from — a complete drop table the guild wrote
     *      without anyone reading it as one.
     *   2. **The item cache's own attributions**, for the tiers no sheet covers:
     *      Karazhan, SSC and Tempest Keep, learned from Wowhead one item at a
     *      time. Second, so a sheet's wording wins where both know a drop.
     *
     * It lives here because parsing sheets is the read model's job — doing it
     * in a backend would be a second parser to keep in step with this one.
     */
    async listKnownDropSources(): Promise<{
      drafts: BossDropDraft[];
      fromSheets: number;
      fromCache: number;
    }> {
      const drafts: BossDropDraft[] = [];
      const seen = new Set<string>();
      /**
       * Claim a drop, deduping on the ITEM where one is known and on the name
       * only where it is not.
       *
       * Keying on the name alone let the same item in twice under one boss: the
       * sheet pass writes "Hammer of Judgment" and the cache pass writes
       * "Hammer of Judgement", which normalize differently and are the same
       * drop. Three of this guild's rows were duplicated exactly that way.
       *
       * Both keys are claimed on every successful push, so whichever pass runs
       * second is blocked by either half.
       */
      const push = (zone: string, boss: string, itemName: string, extra: Partial<BossDropDraft>) => {
        const at = `${zone.toLowerCase()}|${bossKey(boss)}`;
        const nameKey = `${at}|${normalizeItemName(itemName)}`;
        const idKey = extra.itemId === undefined ? undefined : `${at}|#${extra.itemId}`;
        if (seen.has(nameKey) || (idKey !== undefined && seen.has(idKey))) return false;
        seen.add(nameKey);
        if (idKey !== undefined) seen.add(idKey);
        drafts.push({ zone, boss, itemName, ...extra });
        return true;
      };

      let fromSheets = 0;
      for (const phase of PHASE_IDS) {
        for (const rule of rulesForPhase(phase)) {
          const source = sheetSectionSource(rule.source);
          if (!source) continue;
          // The pin matters here for the same reason it did on the loot plan:
          // the sheet's "Hammer of Judgment" and the cache's "Hammer of
          // Judgement" are one drop only because an officer said so.
          const id = sheetItemIdFor(rule.itemName);
          if (push(source.zone, source.boss, rule.itemName, { slotLabel: rule.slotLabel, itemId: id })) {
            fromSheets += 1;
          }
        }
      }

      let fromCache = 0;
      for (const item of items) {
        const zone = item.source?.zone;
        const boss = item.source?.boss;
        if (!zone || !boss || !item.name) continue;
        if (push(zone, boss, item.name, { itemId: item.id })) fromCache += 1;
      }

      return { drafts, fromSheets, fromCache };
    },

    /**
     * Foundational rows that list one item twice under one boss.
     *
     * They cannot heal themselves: the table's key is (zone, boss, item NAME),
     * so two spellings of one item are two legitimate-looking rows and an
     * upsert will never collapse them. Returns the rows to delete, never the
     * one to keep.
     *
     * Which one survives, in order: **the spelling a priority sheet uses**,
     * because the sheet references the table and its wording may be carrying a
     * distinction the item name cannot ("(Main Hand)" on a Warglaive); then the
     * spelling matching the resolved item; then the first, so the answer is
     * deterministic rather than whatever the database happened to return.
     */
    async listDuplicateDrops(): Promise<{ zone: string; boss: string; itemName: string }[]> {
      const sheetNames = new Set<string>();
      for (const phase of PHASE_IDS) {
        for (const rule of rulesForPhase(phase)) sheetNames.add(normalizeItemName(rule.itemName));
      }
      const groups = new Map<string, BossDrop[]>();
      for (const drop of bossDrops) {
        if (drop.itemId === undefined) continue;
        const key = `${drop.zone.toLowerCase()}|${drop.bossKey}|${drop.itemId}`;
        groups.set(key, [...(groups.get(key) ?? []), drop]);
      }
      const doomed: { zone: string; boss: string; itemName: string }[] = [];
      for (const rows of groups.values()) {
        if (rows.length < 2) continue;
        const score = (d: BossDrop): number => {
          if (sheetNames.has(d.itemKey)) return 0;
          const real = itemsById.get(d.itemId!)?.name;
          if (real && normalizeItemName(real) === d.itemKey) return 1;
          return 2;
        };
        const ordered = [...rows].sort(
          (a, b) => score(a) - score(b) || compareText(a.itemKey, b.itemKey),
        );
        for (const drop of ordered.slice(1)) {
          doomed.push({ zone: drop.zone, boss: drop.boss, itemName: drop.itemName });
        }
      }
      return doomed;
    },

    /**
     * The foundational table alone, for whoever is editing it.
     *
     * Deliberately separate from `getDropTable`: an operator correcting a name
     * must see what they own, not what one guild's overlay has made of it.
     */
    async listFoundationalDrops(zone?: string): Promise<BossDrop[]> {
      const target = zone?.toLowerCase();
      return bossDrops.filter((d) => target === undefined || d.zone.toLowerCase() === target);
    },

    /**
     * The same rows, with each drop's item resolved — icon, quality, and the
     * name the cache actually has for it.
     *
     * No guild overlay: this is the shared table as its owner sees it. The
     * resolution is what makes the page useful for correcting: `writtenName`
     * says what somebody typed and `itemName` what the item is really called,
     * which is the difference an operator came here to close.
     */
    async getFoundationalDropTable(zone: string): Promise<MergedDrop[]> {
      const target = zone.toLowerCase();
      const merged = mergeDropTable(
        bossDrops.filter((d) => d.zone.toLowerCase() === target),
        [],
      );
      return resolveDropNames(merged, (id) => {
        const item = itemsById.get(id);
        return item && { name: item.name, quality: item.quality, icon: item.icon };
      });
    },

    async listGuildDropOverrides(zone?: string): Promise<GuildBossDrop[]> {
      const target = zone?.toLowerCase();
      return guildBossDrops.filter(
        (d) => d.guildId === guild.id && (target === undefined || d.zone.toLowerCase() === target),
      );
    },

    /**
     * Drops the council's sheet can place and the cache cannot.
     *
     * The sheet is written boss by boss, so its headings already say where 64
     * of this guild's own Phase 3 items come from — three whole Black Temple
     * bosses' worth. The cache learned those ids from wishlists, which carry a
     * name and nothing else, so they have no zone; and `items.source.zone` is
     * the only thing that puts a drop on a raid's loot plan. They were invisible
     * there while sitting in plain sight on the priority page.
     *
     * Only rows with **no source at all** are offered. A row that already has
     * one is either Wowhead's answer or an officer's, and both outrank a section
     * heading — the gap-filling writer would refuse it anyway, so proposing it
     * would only inflate the count the officer is shown.
     */
    async listSheetDropSources(): Promise<{ id: number; source: { zone: string; boss: string } }[]> {
      const out: { id: number; source: { zone: string; boss: string } }[] = [];
      const seen = new Set<number>();
      // Driven from the sheet's rows, not from the cache's names, so an
      // officer's pin is honoured: the sheet's "Hammer of Judgment" and the
      // cache's "Hammer of Judgement" are the same drop only because somebody
      // said so, and matching on the name alone silently missed it.
      //
      // Every phase, like the name lookup beside it: a sheet written for a tier
      // nobody has raided yet is exactly the one the cache knows least about.
      for (const phase of PHASE_IDS) {
        for (const rule of rulesForPhase(phase)) {
          const id = sheetItemIdFor(rule.itemName);
          if (id === undefined || seen.has(id)) continue;
          // Only rows with no source at all. One that has one was answered by
          // Wowhead or by an officer, and both outrank a section heading.
          if (itemsById.get(id)?.source?.zone) continue;
          const source = sheetSectionSource(rule.source);
          if (!source) continue;
          seen.add(id);
          out.push({ id, source });
        }
      }
      return out;
    },

    /**
     * The council's notes for one zone, by boss key.
     *
     * A map rather than a per-boss call: the loot plan renders every boss at
     * once, and asking per boss would be one query per card for data already
     * held in memory.
     */
    async listBossComments(zone: string): Promise<Map<string, BossComment[]>> {
      const target = zone.toLowerCase();
      const out = new Map<string, BossComment[]>();
      for (const [, list] of bossCommentsByBoss) {
        for (const c of list) {
          if (c.zone.toLowerCase() !== target) continue;
          out.set(c.bossKey, [...(out.get(c.bossKey) ?? []), c]);
        }
      }
      return out;
    },

    async listUnmatchedSheetNames(): Promise<string[]> {
      const known = new Set<string>(Object.keys(config.sheetItemIds ?? {}));
      for (const item of items) {
        if (item.name) known.add(normalizeItemName(item.name));
      }
      // Already asked and declined: a person's job now, not another press.
      for (const r of config.refusedItemNames ?? []) known.add(r.nameKey);
      const missing = new Map<string, string>();
      // Every phase, not just the active one: a sheet the guild wrote for next
      // tier is exactly the one nobody has wishlisted out of yet, so it is the
      // one with the most unmatched rows.
      for (const phase of PHASE_IDS) {
        for (const rule of rulesForPhase(phase)) {
          const key = normalizeItemName(rule.itemName);
          if (!known.has(key) && !missing.has(key)) missing.set(key, rule.itemName);
        }
      }
      return [...missing.values()].sort((a, b) => compareText(a, b));
    },
  } satisfies Partial<Repo> & ThisType<Repo>;
}
