import type { GearSet, Item, LootAward, Quality, SlotId, WclPlayerFight } from "@/lib/types";

/**
 * The item cache's filling rules.
 *
 * Nothing here fetches: every import already carries pieces of item data —
 * a Gargul link has a name and quality, a SixtyUpgrades slot has a name, a
 * Warcraft Logs gear snapshot has an icon and nothing else — and the cache is
 * the one place they get merged, keyed by item id. What no source knows is
 * left empty for the Wowhead resolver (lib/items/wowhead) to fill once.
 */

/** A name the app invented because it had nothing better ("Item #30048"). */
const PLACEHOLDER_NAME = /^item\s*#?\s*\d+$/i;

export function isPlaceholderName(name: string | undefined): boolean {
  return name === undefined || name.trim() === "" || PLACEHOLDER_NAME.test(name.trim());
}

/**
 * The best name available for an item, in source order, falling back to the
 * id. Invented names are skipped wherever they turn up — old award rows have
 * "Item #30048" frozen into them, and a real name from any later source has to
 * win over it.
 */
export function itemDisplayName(itemId: number, ...candidates: (string | undefined)[]): string {
  return candidates.find((n) => !isPlaceholderName(n))?.trim() ?? `Item #${itemId}`;
}

/**
 * Icon names as the CDN wants them: bare, no extension. Log gear snapshots
 * spell them "inv_helmet_15.jpg", the curated cache "inv_helmet_15", and
 * iconUrl() appends the extension itself.
 */
export function normalizeIcon(icon: string | undefined): string | undefined {
  const bare = icon?.trim().replace(/\.(jpg|jpeg|png|gif|webp)$/i, "");
  return bare ? bare : undefined;
}

/**
 * Wowhead inventory-slot ids → our slot ids. Paired slots resolve to the first
 * of the pair (SLOT_FAMILIES treats ring1/ring2 and the trinkets as one), and
 * slots the tracker doesn't model (shirt, tabard, bags) stay undefined.
 * Relics sit in the ranged slot in TBC.
 */
const SLOT_BY_INVENTORY_TYPE: Record<number, SlotId> = {
  1: "head",
  2: "neck",
  3: "shoulder",
  5: "chest",
  6: "waist",
  7: "legs",
  8: "feet",
  9: "wrist",
  10: "hands",
  11: "ring1",
  12: "trinket1",
  13: "mainHand",
  14: "offHand",
  15: "ranged",
  16: "back",
  17: "mainHand",
  20: "chest",
  21: "mainHand",
  22: "offHand",
  23: "offHand",
  25: "ranged",
  26: "ranged",
  28: "ranged",
};

/**
 * The slot an inventory type sits in, or undefined for the ones the tracker
 * doesn't model — and for the ids that genuinely have no slot at all, which is
 * how an armor token arrives.
 */
export function slotFromInventoryType(inventoryType: number | undefined): SlotId | undefined {
  return inventoryType === undefined ? undefined : SLOT_BY_INVENTORY_TYPE[inventoryType];
}

/**
 * WoW's numeric quality scale, as both Warcraft Logs and Wowhead report it.
 * Anything outside 0–5 is "we don't know" rather than a guess.
 */
const QUALITY_BY_ID: Record<number, Quality> = {
  0: "poor",
  1: "common",
  2: "uncommon",
  3: "rare",
  4: "epic",
  5: "legendary",
};

export function qualityFromId(id: number | null | undefined): Quality | undefined {
  return id === null || id === undefined ? undefined : QUALITY_BY_ID[id];
}

/** Everything one source knows about one item — any subset but the id. */
export type ItemFacts = Partial<Omit<Item, "id">> & { id: number };

/**
 * Fold many partial sightings of the same item into one entry each. First
 * sighting of a field wins, so callers pass their most trustworthy source
 * first; empty and invented values never overwrite a real one.
 */
export function mergeItemFacts(facts: ItemFacts[]): Item[] {
  const byId = new Map<number, Item>();
  for (const fact of facts) {
    if (!Number.isInteger(fact.id) || fact.id <= 0) continue;
    const entry = byId.get(fact.id) ?? { id: fact.id };
    entry.name ??= isPlaceholderName(fact.name) ? undefined : fact.name?.trim();
    entry.quality ??= fact.quality;
    entry.icon ??= normalizeIcon(fact.icon);
    entry.slot ??= fact.slot ?? undefined;
    entry.source ??= fact.source;
    entry.phase ??= fact.phase;
    byId.set(fact.id, entry);
  }
  // An entry that learned nothing but its own id is not worth a row.
  return [...byId.values()].filter(
    (i) => i.name !== undefined || i.icon !== undefined || i.quality !== undefined,
  );
}

/**
 * Item data already sitting in imported records, harvested for the cache:
 * names from wishlists and loot pastes, icons from the gear snapshot every
 * logged pull carries. Free — this is data the database already stores, just
 * buried in per-row JSON where nothing can look it up by id.
 */
export function harvestItemFacts(input: {
  gearSets: GearSet[];
  lootAwards: LootAward[];
  wclPlayerFights: WclPlayerFight[];
}): Item[] {
  const facts: ItemFacts[] = [];
  // Gear sets first: a wishlist name is typed by a person and the most exact.
  for (const set of input.gearSets) {
    for (const slot of set.slots) {
      facts.push({ id: slot.itemId, name: slot.itemName, slot: slot.slot });
      // A glyph/inscription/leg-armor enchant is applied by an item, and that
      // item's icon is what the gear panel shows next to the enchant's name.
      if (slot.enchant?.itemId) facts.push({ id: slot.enchant.itemId, name: slot.enchant.name });
      for (const gem of slot.gems ?? []) if (gem.id) facts.push({ id: gem.id, name: gem.name, icon: gem.icon });
    }
  }
  for (const award of input.lootAwards) facts.push({ id: award.itemId, name: award.itemName });
  for (const row of input.wclPlayerFights) {
    for (const item of row.gear) {
      facts.push({ id: item.id, name: item.name, icon: item.icon, quality: item.quality });
      // Gems are items too — the log gives their icon, the cache the name.
      for (const gem of item.gems) facts.push({ id: gem.id, icon: gem.icon });
    }
  }
  return mergeItemFacts(facts);
}
