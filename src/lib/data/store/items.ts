import { buildEnchantReference, type EnchantReference } from "@/lib/analysis/enchants";
import { normalizeItemName } from "@/lib/loot/priority-sheet";
import { PHASE_IDS } from "@/lib/constants/wow";
import type { Item, RefusedNameView } from "@/lib/types";
import type { Repo, TokenBackfillQueue } from "@/lib/data/repo";
import { compareText } from "@/lib/sort";
import type { StoreContext } from "./context";

/**
 * The item cache, and the queues for what it still does not know.
 *
 * Three of these are worklists rather than views: unresolved ids, unnamed
 * enchant ids, and the token backfill. Each answers "what has this deployment
 * not asked Wowhead yet", and each is deliberately conservative — a row stays
 * on the list until an authoritative answer arrives, because "has an icon" and
 * "has the right icon" are different claims and a cache that conflated them
 * once reported itself complete while showing eight wrong pictures.
 */

export function itemViews(ctx: StoreContext) {
  const { config, charactersById, consumableNames, currentGearOverrides, gearSets, itemCommentsByItem, items, itemsById, lootAwards, rulesForPhase, wclPlayerFights } = ctx;
  return {
    async getItem(id: number) {
      return itemsById.get(id);
    },

    async listItems() {
      return items;
    },

    async listConsumableItems(): Promise<Item[]> {
      const wanted = new Set(consumableNames().map(normalizeItemName));
      return items.filter(
        (item) => item.name !== undefined && wanted.has(normalizeItemName(item.name)),
      );
    },

    async listRefusedItemNames(): Promise<RefusedNameView[]> {
      /*
       * Only the refusals that still matter.
       *
       * A refusal is a fact about a name, and names stop being used: a sheet row
       * is corrected, a curated consumable label is moved onto the item it
       * actually is. Listing a verdict on a name nothing references any more
       * would leave the officer a chore that finished itself.
       */
      const live = new Set<string>();
      for (const name of consumableNames()) live.add(normalizeItemName(name));
      for (const phase of PHASE_IDS) {
        for (const rule of rulesForPhase(phase)) live.add(normalizeItemName(rule.itemName));
      }
      /*
       * Settled by any route, not just by a matching cache name.
       *
       * A pin is the other one, and it does NOT put the name in the cache: an
       * officer pinning "Warglaive of Azzinoth (Main Hand)" — an annotation
       * that is nobody's item name — attaches it to an id whose real name is
       * something else. Checking only the cache leaves the finished job on the
       * list forever, which is the failure this whole record exists to avoid.
       */
      const settled = new Set<string>(Object.keys(config.sheetItemIds ?? {}));
      for (const item of items) {
        if (item.name) settled.add(normalizeItemName(item.name));
      }
      return (config.refusedItemNames ?? [])
        .filter((r) => live.has(r.nameKey) && !settled.has(r.nameKey))
        .sort((a, b) => compareText(a.name, b.name));
    },

    async getEnchantReference(): Promise<EnchantReference> {
      return buildEnchantReference(
        gearSets,
        (characterId) => {
          const owner = charactersById.get(characterId);
          return owner ? { class: owner.class, role: owner.role } : undefined;
        },
        config.enchantNames,
      );
    },

    async listUnnamedEnchantIds(): Promise<number[]> {
      // Every enchant id ever logged that no imported set and no earlier
      // lookup names, commonest first — a backfill run is capped, so the
      // ordering decides which raiders stop seeing a bare id soonest.
      const named = new Set<number>();
      for (const set of gearSets) {
        for (const slot of set.slots) if (slot.enchant?.id) named.add(slot.enchant.id);
      }
      for (const id of Object.keys(config.enchantNames ?? {})) named.add(Number(id));
      const counts = new Map<number, number>();
      const want = (id: number | undefined) => id !== undefined && id > 0 && !named.has(id);
      for (const row of wclPlayerFights) {
        for (const item of row.gear) {
          if (want(item.enchant)) {
            counts.set(item.enchant!, (counts.get(item.enchant!) ?? 0) + 1);
          }
          /*
           * Temporary enchants too — the oils, stones and poisons the raid
           * page's weapon-buff column reports.
           *
           * They were never queued, so that column could only ever say "a
           * temporary enchant was present". The same dictionary names them:
           * every one of this guild's sixteen resolved on the first run, most
           * to an item name outright ("Superior Wizard Oil"), the sharpening
           * stones to their effect text.
           */
          if (want(item.temp)) {
            counts.set(item.temp!, (counts.get(item.temp!) ?? 0) + 1);
          }
        }
      }
      return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([id]) => id);
    },

    async listTokenBackfill(): Promise<TokenBackfillQueue> {
      // An armor token is the one drop that isn't the thing anyone wants, and
      // the cache can't tell one apart from a name. Wowhead can — it files
      // them under a subclass of their own — so this is two queues, in the
      // order the two Wowhead calls have to happen:
      //
      //   unchecked          ids that might be tokens; one cheap XML each.
      //   tokensWithoutPieces  known tokens; one page each, for the vendor list.
      //
      // Candidates are every row Wowhead has confirmed that no gear set names.
      // That test is structural rather than a guess about names: a token can't
      // be equipped, so nothing that exports a gear set can ever name one, and
      // an id somebody wishlisted is provably not a token. A row nothing has
      // verified belongs to the item resolver's queue first.
      //
      // Deliberately NOT "has no slot", though a token has none. The shipped
      // seed invented slots for a dozen of them, and a queue that trusted the
      // slot skipped exactly the rows that were wrong.
      const buysSomething = new Set<number>();
      for (const item of items) {
        if (item.redeemsFrom !== undefined) buysSomething.add(item.redeemsFrom);
      }
      // Order decides what a capped press spends itself on, so: loot the guild
      // actually won first (a token in the ledger has awards waiting on it),
      // then the rows with no slot (what a token looks like when the seed
      // didn't touch it), then everything else. The tail is mostly gems and
      // consumables — each costs one lookup, once, and is then answered
      // forever, so leaving it undrained costs nothing.
      const awarded = new Set(lootAwards.map((a) => a.itemId));
      const rank = (id: number): number =>
        awarded.has(id) ? 0 : itemsById.get(id)?.slot == null ? 1 : 2;
      const byLikelihoodThenId = (a: number, b: number): number => rank(a) - rank(b) || a - b;

      const equippable = new Set<number>();
      for (const set of gearSets) for (const slot of set.slots) equippable.add(slot.itemId);

      const unchecked: number[] = [];
      const tokensWithoutPieces: number[] = [];
      for (const item of items) {
        if (item.armorToken === true) {
          if (!buysSomething.has(item.id)) tokensWithoutPieces.push(item.id);
        } else if (item.armorToken === undefined && item.verified && !equippable.has(item.id)) {
          unchecked.push(item.id);
        }
      }
      return {
        unchecked: unchecked.sort(byLikelihoodThenId),
        tokensWithoutPieces: tokensWithoutPieces.sort(byLikelihoodThenId),
      };
    },

    async listUnresolvedItemIds(): Promise<number[]> {
      // Ordered by how much a person is looking at them: loot history and
      // wishlists first (they carry the ledger), then anything else the cache
      // half-knows — mostly gear ids harvested from logs, which have an icon
      // but no name. Callers resolve a capped slice per run, so the ordering
      // decides what gets fixed first, not what gets fixed at all.
      const LEDGER_WEIGHT = 100;
      const references = new Map<number, number>();
      const bump = (id: number, weight: number) =>
        references.set(id, (references.get(id) ?? 0) + weight);
      for (const award of lootAwards) bump(award.itemId, LEDGER_WEIGHT);
      for (const set of gearSets) for (const slot of set.slots) bump(slot.itemId, LEDGER_WEIGHT);
      // A pinned slot is read off a log, so it often arrives with an icon but
      // no name — exactly what the resolver exists for.
      for (const override of currentGearOverrides) bump(override.item.itemId, LEDGER_WEIGHT);
      // Gems show on the gear panel by icon; only their name needs looking up.
      for (const row of wclPlayerFights) {
        for (const item of row.gear) for (const gem of item.gems) bump(gem.id, 1);
      }
      // Every cached row is a candidate, because "has an icon" and "has the
      // right icon" are different claims — see `needsResolving` below.
      for (const item of items) bump(item.id, 1);

      // A row with a hole in it reads as broken; a row Wowhead has never
      // confirmed only *might* be wrong. Both need the same lookup, so the
      // tier decides which the officer's next press spends itself on.
      const INCOMPLETE = 1;
      const UNVERIFIED = 0;
      /*
       * Verified, complete, and confirmed before the phase was read off
       * Wowhead's answer.
       *
       * The XML carried the phase all along and it was thrown away, so every
       * row resolved before that has a hole nothing else would ever ask about
       * again. Keyed on `phaseChecked` rather than on the phase being missing:
       * plenty of items have no phase tag, and queueing on the hole itself
       * would re-ask about them every press for ever.
       *
       * Lowest tier on purpose — it is a nicety, and must never spend a capped
       * run that a row with no name at all is waiting on.
       */
      const STALE_PHASE = -1;
      const tierOf = (id: number): number | undefined => {
        const item = itemsById.get(id);
        if (item === undefined || item.name === undefined || item.icon === undefined) {
          return INCOMPLETE;
        }
        if (!item.verified) return UNVERIFIED;
        return item.phaseChecked ? undefined : STALE_PHASE;
      };

      return [...references]
        .map(([id, weight]) => ({ id, weight, tier: tierOf(id) }))
        .filter((c): c is { id: number; weight: number; tier: number } => c.tier !== undefined)
        .sort((a, b) => b.tier - a.tier || b.weight - a.weight || a.id - b.id)
        .map((c) => c.id);
    },

    async listItemComments(itemId: number) {
      return itemCommentsByItem.get(itemId) ?? [];
    },

    async countItemComments() {
      return new Map([...itemCommentsByItem].map(([id, list]) => [id, list.length]));
    },
  } satisfies Partial<Repo> & ThisType<Repo>;
}
