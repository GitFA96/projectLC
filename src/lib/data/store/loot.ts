import {
  buildLootPlan,
  type LootPlanEntry,
  type LootPlanSheetDrop,
} from "@/lib/analysis/loot-plan";
import { dropKey } from "@/lib/loot/drop-table";
import { LOOT_PRIORITY_SHEET_PHASE } from "@/data/seed/loot-priority-p3";
import { buildPrioritySheetView, normalizeItemName } from "@/lib/loot/priority-sheet";
import { sheetSectionSource } from "@/lib/loot/sheet-sources";
import { buildPolicyPreview } from "@/lib/analysis/policy-preview";
import { PHASE_IDS, bossKey } from "@/lib/constants/wow";
import { itemDisplayName } from "@/lib/items/item-data";
import type { ItemDemand } from "@/lib/types";
import type { Repo } from "@/lib/data/repo";
import { compareText } from "@/lib/sort";
import { sheetMarkdownFor } from "./context";
import type { StoreContext } from "./context";

/**
 * Who should get an item, and on what grounds.
 *
 * `getLootPlan` is the biggest thing in this directory and earns it — it merges
 * four sources of "what drops here" and applies the guild's overlay to all of
 * them, because a drop reaching the plan from `items.source` or a sheet heading
 * arrives by a different door than one from the drop table and would otherwise
 * survive being hidden (change-chains §4h3).
 *
 * Every weight and threshold behind a verdict comes from the resolved policy on
 * the context, never from a constant here — root AGENTS.md invariant 5. A
 * number that changes a verdict belongs in `analysis/policy.ts`, where the
 * guild can edit it.
 */

export function lootViews(ctx: StoreContext) {
  const { config, awardsWithContext, contentionFor, gearSets, guild, guildBossDrops, items, itemsById, lootAwards, priorityRuleFor, raidSessions, rulesForPhase, sheetItemIdFor } = ctx;
  return {
    async listRaidSessions() {
      return [...raidSessions].sort((a, b) => compareText(b.date, a.date));
    },

    async listLootAwards() {
      return awardsWithContext;
    },

    async getItemContention(itemId: number) {
      const contention = contentionFor(itemId);
      if (!contention.item && contention.awards.length === 0 && contention.wishers.length === 0) {
        return null;
      }
      return contention;
    },

    async listItemDemand(): Promise<ItemDemand[]> {
      // Names for wishlisted items missing from the cache (denormalized on slots).
      const wishlistNames = new Map<number, string>();
      const ids = new Set<number>(itemsById.keys());
      for (const set of gearSets) {
        if (set.kind !== "wishlist") continue;
        for (const slot of set.slots) {
          ids.add(slot.itemId);
          if (!wishlistNames.has(slot.itemId)) wishlistNames.set(slot.itemId, slot.itemName);
        }
      }
      for (const award of lootAwards) ids.add(award.itemId);

      return [...ids]
        .map((itemId): ItemDemand => {
          const item = itemsById.get(itemId);
          const c = contentionFor(itemId);
          return {
            itemId,
            name: itemDisplayName(itemId, item?.name, c.awards[0]?.award.itemName, wishlistNames.get(itemId)),
            quality: item?.quality,
            icon: item?.icon,
            slot: item?.slot,
            source: item?.source,
            phase: item?.phase,
            wisherCount: c.wishers.length,
            openCount: c.openCount,
            awardCount: c.awards.length,
            lastAwardedAt: c.awards[0]?.award.awardedAt,
          };
        })
        .sort(
          (a, b) =>
            b.openCount - a.openCount ||
            b.wisherCount - a.wisherCount ||
            b.awardCount - a.awardCount ||
            compareText(a.name, b.name),
        );
    },

    async getLootPlan(zone: string) {
      const target = zone.toLowerCase();

      // The drop table first — foundational rows with this guild's overlay
      // applied. Where it names a boss for a drop, it wins: that is what makes
      // it the drop table rather than a second opinion. `items.source.boss`
      // stays the fallback for anything nobody has told it about.
      const table = await this.getDropTable(zone);
      const bossByItemId = new Map<number, string>();
      const bossByItemKey = new Map<string, string>();
      // What the table calls a drop, for the rows where that says more than the
      // item's own name does — see `LootPlanEntry.displayName`.
      const nameByItemId = new Map<number, string>();
      for (const drop of table) {
        if (drop.itemId !== undefined) {
          bossByItemId.set(drop.itemId, drop.boss);
          if (drop.resolvedName) nameByItemId.set(drop.itemId, drop.itemName);
        }
        if (!bossByItemKey.has(drop.itemKey)) bossByItemKey.set(drop.itemKey, drop.boss);
      }

      // A hide is the one overlay action that has to REMOVE something, and
      // `getDropTable` has already applied it to the table's own rows. It still
      // has to be applied to drops that reach the plan from the ITEM CACHE
      // instead, or a hidden drop reappears by the other door.
      //
      // Keyed on the pair, through the table's own `dropKey`: keying on the
      // item alone also hid the copy a guild had just re-added under a
      // different boss, which is exactly how a move between bosses is written.
      const hidden = new Set(
        guildBossDrops
          .filter(
            (d) => d.guildId === guild.id && d.zone.toLowerCase() === target && d.action === "hide",
          )
          .map((d) => dropKey(d.bossKey, d.itemKey)),
      );

      // Which pairs this guild added themselves, so the plan can say so on a
      // row that would otherwise look like everybody else's.
      const guildAdded = new Set(
        guildBossDrops
          .filter(
            (d) => d.guildId === guild.id && d.zone.toLowerCase() === target && d.action === "add",
          )
          .map((d) => dropKey(d.bossKey, d.itemKey)),
      );

      // What they have taken off a boss. Not on the plan by definition, and
      // carried anyway: a hidden drop has no row to un-hide from.
      const hiddenDrops = guildBossDrops
        .filter(
          (d) => d.guildId === guild.id && d.zone.toLowerCase() === target && d.action === "hide",
        )
        .map((d) => ({ itemName: d.itemName, itemId: d.itemId, boss: d.boss }));

      const entries: LootPlanEntry[] = [];
      const covered = new Set<string>();
      const claim = (name: string | undefined): string | undefined => {
        if (!name) return undefined;
        const key = normalizeItemName(name);
        if (covered.has(key)) return undefined;
        covered.add(key);
        return key;
      };

      // 1. Cached items the zone drops. Still first: they carry the contention,
      //    the icon and the id, and nothing here is allowed to lose them.
      for (const item of items) {
        if ((item.source?.zone ?? "").toLowerCase() !== target) continue;
        const key = item.name ? normalizeItemName(item.name) : undefined;
        const boss = bossByItemId.get(item.id) ?? (key ? bossByItemKey.get(key) : undefined);
        // The pair the guild would have hidden is this item under whichever
        // boss the plan is about to file it under — the table's answer if it has
        // one, the cache's otherwise.
        const under = boss ?? item.source?.boss;
        if (key && under && hidden.has(dropKey(bossKey(under), key))) continue;
        if (key) covered.add(key);
        entries.push({
          item,
          contention: contentionFor(item.id),
          boss,
          guildAdded: guildAdded.has(dropKey(bossKey(under ?? ""), key ?? "")),
          displayName: nameByItemId.get(item.id),
        });
      }

      // 2. Drops the table knows an id for that the cache has not attributed to
      //    this zone. This is the table earning its keep: an operator says
      //    Supremus drops it and it appears, without anyone curating the item.
      for (const drop of table) {
        // No hide check: `getDropTable` already applied the overlay to these.
        if (drop.itemId === undefined) continue;
        const item = itemsById.get(drop.itemId);
        if (!item || !claim(item.name ?? drop.itemName)) continue;
        entries.push({
          item,
          contention: contentionFor(item.id),
          boss: drop.boss,
          guildAdded: drop.origin === "guild",
          displayName: nameByItemId.get(item.id),
        });
      }

      // 3. Drops the table names but nothing has an id for. Rendered by name,
      //    with no icon and nothing to click — see `sheetOnly`.
      const sheetDrops: LootPlanSheetDrop[] = [];
      for (const drop of table) {
        if (drop.itemId !== undefined) continue;
        if (!claim(drop.itemName)) continue;
        sheetDrops.push({
          itemName: drop.itemName,
          boss: drop.boss,
          chain: priorityRuleFor(drop.itemName)?.chain,
          slotLabel: drop.slotLabel,
          guildAdded: drop.origin === "guild",
        });
      }

      // 4. Finally the council's own sheet, for anything still unaccounted for.
      //    This is what carries a zone whose drop table nobody has seeded yet —
      //    without it, switching the plan to the table would have emptied every
      //    page until an operator pressed a button.
      for (const phase of PHASE_IDS) {
        for (const rule of rulesForPhase(phase)) {
          const key = normalizeItemName(rule.itemName);
          if (covered.has(key)) continue;
          // `sheetItemIdFor`, not a name match: a pinned row HAS an item, and
          // listing it here too put it on the plan twice — once as the real
          // drop and once as bare text that could not be clicked.
          if (sheetItemIdFor(rule.itemName) !== undefined) continue;
          const source = sheetSectionSource(rule.source);
          if (!source || source.zone.toLowerCase() !== target) continue;
          if (hidden.has(dropKey(bossKey(source.boss), key))) continue;
          covered.add(key);
          sheetDrops.push({
            itemName: rule.itemName,
            boss: source.boss,
            // Through the same lookup every other view uses, so an officer's
            // edited chain shows here too — a plan quoting the seeded sheet
            // while the item page quoted the edit would be worse than no chain.
            chain: priorityRuleFor(rule.itemName)?.chain,
            slotLabel: rule.slotLabel,
          });
        }
      }

      return buildLootPlan(zone, entries, sheetDrops, hiddenDrops);
    },

    async getPrioritySheet(phase?: number) {
      const forPhase = phase ?? guild.activePhase;
      const stored = config.prioritySheetsByPhase?.[forPhase];
      const view = buildPrioritySheetView({
        rules: rulesForPhase(forPhase),
        // This phase's chains only. A chain an officer wrote against another
        // tier's sheet still applies to its drop (priorityRuleFor walks every
        // phase), but listing it here put both Warglaives on the phase 2 page.
        overrides: config.itemPriorityRules?.[forPhase] ?? {},
        // Shared with the loot plan and the drop-source pass — see
        // `sheetItemIdFor`. The builder stays pure and only ever sees names.
        itemIdFor: sheetItemIdFor,
      });
      // Icon and quality for the rows whose name the cache matched, so the
      // sheet renders items the way every other list does. Done here, not in
      // the builder: the builder is pure and only ever sees names.
      const withItem = <T extends { itemId?: number }>(row: T): T => {
        const item = row.itemId === undefined ? undefined : itemsById.get(row.itemId);
        return item ? { ...row, quality: item.quality, icon: item.icon, itemPhase: item.phase } : row;
      };
      return {
        ...view,
        sections: view.sections.map((s) => ({ ...s, rows: s.rows.map(withItem) })),
        unlisted: view.unlisted.map(withItem),
        phase: forPhase,
        origin: stored
          ? ("pasted" as const)
          : forPhase === LOOT_PRIORITY_SHEET_PHASE
            ? ("seed" as const)
            : ("none" as const),
        updatedAt: stored?.updatedAt,
        author: stored?.author,
        sheetNote: stored?.note,
        markdown: sheetMarkdownFor(forPhase, config.prioritySheetsByPhase),
      };
    },

    async getItemPriorityRule(itemId: number, ...names: (string | undefined)[]) {
      const item = itemsById.get(itemId);
      return priorityRuleFor(
        ...names,
        item?.name,
        lootAwards.find((a) => a.itemId === itemId)?.itemName,
        gearSets.flatMap((s) => s.slots).find((s) => s.itemId === itemId)?.itemName,
      );
    },

    /**
     * Previewing a policy needs TWO read models, so it can't live here — a
     * model only knows its own policy. The SQLite backend builds the second
     * one and diffs; the seed backend is read-only and has no policy to change.
     */
    async previewGuildPolicy() {
      return buildPolicyPreview(await this.measureRoster());
    },
  } satisfies Partial<Repo> & ThisType<Repo>;
}
