import type { ConsumablePrice } from "@/lib/types";
import { baseConsumableName } from "@/lib/wcl/consumables";

/**
 * Default gold prices + charges for in-fight consumables — the FALLBACK a raid
 * uses until someone logs that week's real prices (see the price panel on the
 * logs page). Prices drift with the server economy, so per-raid overrides are
 * the source of truth; these just keep the "gold spent" view populated when a
 * raid's prices haven't been entered.
 *
 * `gold` is the price of one purchased item; `charges` is how many uses you get
 * from it (Drums ~50, most consumables 1). Cost per use = gold / charges.
 * Conjured/self-made items (mage mana gems, warlock healthstones) are 0 gold.
 */
const CONSUMABLE_DEFAULTS: Record<string, ConsumablePrice> = {
  /* Combat potions (single use) */
  "Haste Potion": { gold: 15, charges: 1 },
  "Destruction Potion": { gold: 17, charges: 1 },
  "Insane Strength Potion": { gold: 15, charges: 1 },
  "Heroic Potion": { gold: 8, charges: 1 },
  "Ironshield Potion": { gold: 2, charges: 1 },
  "Super Mana Potion": { gold: 2, charges: 1 },
  "Fel Mana Potion": { gold: 12, charges: 1 },
  /* Reputation / instance-vendor restores — bought with rep or badges, so the
     gold price is the vendor cost rather than an auction-house one. */
  "Cenarion Mana Salve": { gold: 1, charges: 1 },
  "Cenarion Healing Salve": { gold: 1, charges: 1 },
  "Bottled Nethergon Energy": { gold: 1, charges: 1 },
  "Bottled Nethergon Vapor": { gold: 1, charges: 1 },
  "Super Healing Potion": { gold: 6, charges: 1 },
  "Mighty Rage Potion": { gold: 10, charges: 1 },
  "Major Mana Potion": { gold: 1, charges: 1 },
  "Free Action Potion": { gold: 6, charges: 1 },
  "Living Action Potion": { gold: 8, charges: 1 },
  "Major Fire Protection Potion": { gold: 6, charges: 1 },
  "Major Frost Protection Potion": { gold: 6, charges: 1 },
  "Major Nature Protection Potion": { gold: 6, charges: 1 },
  "Major Arcane Protection Potion": { gold: 6, charges: 1 },
  "Major Shadow Protection Potion": { gold: 6, charges: 1 },
  "Major Holy Protection Potion": { gold: 6, charges: 1 },
  /* Drums — one item carries many charges, so cost per use is a fraction. */
  "Drums of Battle": { gold: 12, charges: 50 },
  "Drums of War": { gold: 12, charges: 50 },
  "Drums of Restoration": { gold: 15, charges: 50 },
  "Drums of Speed": { gold: 12, charges: 50 },
  "Drums of Panic": { gold: 10, charges: 50 },
  /* Mana runes (single use) */
  "Dark Rune": { gold: 6, charges: 1 },
  "Demonic Rune": { gold: 10, charges: 1 },
  /*
   * Engineering explosives (single use). The Arcane Bomb is deliberately absent
   * and so prices at 0: nobody has quoted the council one, and a guess here
   * would move a real gold ranking — the same rule the thornling seed and the
   * dog whistle sit under. The per-raid price panel is where it gets corrected.
   */
  "Super Sapper Charge": { gold: 15, charges: 1 },
  "Goblin Sapper Charge": { gold: 11, charges: 1 },
  /* Herb/seed & off-slot situational consumables */
  "Nightmare Seed": { gold: 6, charges: 1 },
  "Flame Cap": { gold: 3, charges: 1 },
  "Bogling Root": { gold: 1, charges: 1 },
  "Kreeg's Stout Beatdown": { gold: 1, charges: 1 },
  "Eye of the Night": { gold: 30, charges: 5 },
  Enlightened: { gold: 5, charges: 1 },
  /* Rogue-only, and not an auction-house staple the way a Haste Potion is —
     priced at 0 rather than guessed at, on the same reasoning as the Unstable
     Flasks. If this guild does buy them, a per-raid override is the answer. */
  "Thistle Tea": { gold: 0, charges: 1 },
  /* The Mother Shahraz deployables. The two engineering devices carry the
     council's own baseline of 5g; the seed and the whistle stay at 0 on the
     same reasoning as Thistle Tea and the Unstable Flasks — this app has never
     observed a going rate for them, and a plausible number would move a real
     gold ranking. All four are still overridable per raid in the price panel,
     which remains the source of truth when the economy moves.

     Snake Trap is the fifth thing thrown down beside these and is deliberately
     absent: it is a hunter ability, curated in `class-tracks.ts` rather than as
     a consumable, so it never reaches this catalog at all. Adding it here would
     charge a hunter gold for pressing a button. */
  "Goblin Land Mine": { gold: 5, charges: 1 },
  "Gnomish Flame Turret": { gold: 5, charges: 1 },
  "Thornling Seed": { gold: 0, charges: 1 },
  "Dog Whistle": { gold: 0, charges: 1 },
  /* Pet consumables — a hunter's pet is part of their damage. */
  "Kibler's Bits": { gold: 1, charges: 1 },
  "Pet Biscuit": { gold: 1, charges: 1 },
  /* Flasks (occupy both elixir slots — the priciest staples) */
  "Flask of Blinding Light": { gold: 120, charges: 1 },
  "Flask of Pure Death": { gold: 95, charges: 1 },
  "Flask of Relentless Assault": { gold: 82, charges: 1 },
  /* Unstable Flasks are bought with Apexis Shards, not gold. Priced at 0 so a
     raider running them isn't credited with spending they didn't do — the
     effort is real, but this column measures gold and only gold. */
  "Unstable Flask of the Beast": { gold: 0, charges: 1 },
  "Unstable Flask of the Bandit": { gold: 0, charges: 1 },
  "Unstable Flask of the Elder": { gold: 0, charges: 1 },
  "Unstable Flask of the Physician": { gold: 0, charges: 1 },
  "Unstable Flask of the Soldier": { gold: 0, charges: 1 },
  "Unstable Flask of the Sorcerer": { gold: 0, charges: 1 },
  /* Battle & guardian elixirs */
  "Elixir of Major Agility": { gold: 5, charges: 1 },
  "Elixir of Major Shadow Power": { gold: 6, charges: 1 },
  "Elixir of Healing Power": { gold: 1, charges: 1 },
  "Greater Arcane Elixir": { gold: 4, charges: 1 },
  /*
   * These three are keyed by the ITEM name, which is not what the log calls
   * them — WCL serves them as "Spellpower Elixir", "Greater Mana Regeneration"
   * and "Mageblood Elixir", all buff names. `consumables.ts` now resolves each
   * by spell id to the item that casts it, so ingest stores the item name and
   * these keys are what it stores.
   *
   * **A re-import is what connects them.** Rows imported under the old labels
   * keep those labels, and a label with no key here falls through the
   * name-pattern fallback — which only catches "elixir of…" or "…elixir", so
   * "Greater Mana Regeneration" resolved to 0 gold, free and silently. That is
   * the failure mode to watch whenever a label moves: see change-chains §5.
   */
  "Adept's Elixir": { gold: 12, charges: 1 },
  "Mageblood Potion": { gold: 3, charges: 1 },
  "Elixir of Major Mageblood": { gold: 3, charges: 1 },
  "Elixir of Major Defense": { gold: 4.5, charges: 1 },
  "Elixir of Major Fortitude": { gold: 1, charges: 1 },
  "Elixir of Draenic Wisdom": { gold: 5, charges: 1 },
  "Gift of Arthas": { gold: 2, charges: 1 },
  /*
   * Scrolls, every rank.
   *
   * All five are curated by id now (see `SCROLL_IDS`), so all five reach the
   * gold view as distinct labels and every one needs a price. Rank was
   * previously lost for anything below V, which put 202 uses of Agility IV on
   * this guild's books at the price of a rank I.
   *
   * The shape is the guild's to set on the raid page; what matters here is
   * that the ranks are no longer the same number. Ranks I–III are vendor
   * trash, IV is the auction-house rank most raiders actually buy, and V is
   * the crafted one.
   */
  "Scroll of Agility": { gold: 1, charges: 1 },
  "Scroll of Agility II": { gold: 1, charges: 1 },
  "Scroll of Agility III": { gold: 2, charges: 1 },
  "Scroll of Agility IV": { gold: 3, charges: 1 },
  "Scroll of Agility V": { gold: 8, charges: 1 },
  "Scroll of Strength": { gold: 1, charges: 1 },
  "Scroll of Strength II": { gold: 1, charges: 1 },
  "Scroll of Strength III": { gold: 2, charges: 1 },
  "Scroll of Strength IV": { gold: 3, charges: 1 },
  "Scroll of Strength V": { gold: 6, charges: 1 },
  "Scroll of Spirit": { gold: 0.5, charges: 1 },
  "Scroll of Spirit II": { gold: 0.5, charges: 1 },
  "Scroll of Spirit III": { gold: 1, charges: 1 },
  "Scroll of Spirit IV": { gold: 2, charges: 1 },
  "Scroll of Spirit V": { gold: 0.5, charges: 1 },
  "Scroll of Stamina": { gold: 0.5, charges: 1 },
  "Scroll of Stamina II": { gold: 0.5, charges: 1 },
  "Scroll of Stamina III": { gold: 1, charges: 1 },
  "Scroll of Stamina IV": { gold: 2, charges: 1 },
  "Scroll of Stamina V": { gold: 4, charges: 1 },
  "Scroll of Intellect": { gold: 0.5, charges: 1 },
  "Scroll of Intellect II": { gold: 0.5, charges: 1 },
  "Scroll of Intellect III": { gold: 1, charges: 1 },
  "Scroll of Intellect IV": { gold: 2, charges: 1 },
  "Scroll of Intellect V": { gold: 4, charges: 1 },
  "Scroll of Protection": { gold: 0.5, charges: 1 },
  "Scroll of Protection II": { gold: 0.5, charges: 1 },
  "Scroll of Protection III": { gold: 1, charges: 1 },
  "Scroll of Protection IV": { gold: 1, charges: 1 },
  "Scroll of Protection V": { gold: 1, charges: 1 },
  /* Prep buffs with no logged item name — flat prices, applied when present. */
  Food: { gold: 0.5, charges: 1 },
  "Weapon oil/stone": { gold: 4, charges: 1 },
  /* Conjured / self-made — no gold cost */
  "Master Healthstone": { gold: 0, charges: 1 },
  "Mana Emerald": { gold: 0, charges: 1 },
  "Mana Ruby": { gold: 0, charges: 1 },
  "Mana Citrine": { gold: 0, charges: 1 },
  "Mana Jade": { gold: 0, charges: 1 },
  "Mana Agate": { gold: 0, charges: 1 },
};

/** Fallback for an unpriced potion so a new potion type still costs something. */
const DEFAULT_POTION_GOLD = 8;
/** Flask (both slots) is the priciest single-buff staple. */
const DEFAULT_FLASK_GOLD = 25;
/** A single battle or guardian elixir. */
const DEFAULT_ELIXIR_GOLD = 12;
/** Scroll rank I→V, where V is far pricier than the low ranks (TBC engineering scrolls). */
const SCROLL_GOLD_BY_RANK: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 6, v: 20 };
const DEFAULT_SCROLL_GOLD = 3;

/**
 * The default price + charges for a consumable not explicitly listed. Whole
 * families (flasks, elixirs, scrolls, potions) fall back to a representative
 * price so a new flavour still counts; scrolls scale by rank (V ≫ I).
 */
export function defaultPriceFor(name: string): ConsumablePrice {
  const known = CONSUMABLE_DEFAULTS[name];
  if (known) return known;
  const lower = name.trim().toLowerCase();
  if (lower.includes("flask")) return { gold: DEFAULT_FLASK_GOLD, charges: 1 };
  const scroll = /^scroll of \w+(?:\s+(i{1,3}|iv|v))?$/.exec(lower);
  if (scroll) return { gold: scroll[1] ? SCROLL_GOLD_BY_RANK[scroll[1]] : DEFAULT_SCROLL_GOLD, charges: 1 };
  if (lower.startsWith("elixir of") || lower.endsWith("elixir")) {
    return { gold: DEFAULT_ELIXIR_GOLD, charges: 1 };
  }
  return { gold: /potion$/.test(lower) ? DEFAULT_POTION_GOLD : 0, charges: 1 };
}

/** Gold cost of a single use — the item price spread over its charges. */
export function costPerUse(price: ConsumablePrice): number {
  return price.gold / Math.max(1, price.charges);
}

/**
 * The price in force for a consumable: the raid's logged override, else the
 * default.
 *
 * **Read against the item, not the label.** A pet's copy of a scroll is listed
 * apart so it can be counted and corrected apart, but it is the same scroll off
 * the same auction house — so the suffix comes off before either lookup. Price
 * it by its label instead and it misses the catalog, misses the officer's
 * override for the week, and lands at 0 gold in silence (§5f).
 */
export function effectivePrice(
  name: string,
  overrides: Record<string, ConsumablePrice>,
): ConsumablePrice {
  const item = baseConsumableName(name);
  return overrides[item] ?? overrides[name] ?? defaultPriceFor(item);
}

/** Cost-per-use for each named consumable, applying the raid's overrides. */
export function costPerUseMap(
  names: Iterable<string>,
  overrides: Record<string, ConsumablePrice>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of names) out[name] = costPerUse(effectivePrice(name, overrides));
  return out;
}

/** Total gold for a list of { name, count } lines, given a cost-per-use map. */
export function goldOfBreakdown(
  items: { name: string; count: number }[],
  costPerUse: Record<string, number>,
): number {
  return items.reduce((sum, it) => sum + (costPerUse[it.name] ?? 0) * it.count, 0);
}
