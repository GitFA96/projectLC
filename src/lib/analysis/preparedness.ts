import { elixirCoverage, hasFood, isPrepared } from "@/lib/analysis/preparation";
import { DEFAULT_POLICY, type GuildPolicy } from "@/lib/analysis/policy";
import { ENCHANTABLE_GEAR_SLOTS, consumableGroupOf } from "@/lib/wcl/consumables";
import { GEAR_SLOT_LABELS } from "@/lib/wcl/enchants";
import type {
  PreparednessPet,
  PreparednessSwap,
  PreparednessWorn,
  PreparednessPull,
  PreparednessRow,
  PreparednessView,
  WclPlayerFight,
  WclPlayerOffPull,
} from "@/lib/types";

import { compareText } from "@/lib/sort";

/**
 * What every raider brought, pull by pull.
 *
 * The raid page already reports preparation as a percentage of the night; this
 * is the same evidence with the aggregation taken off, one row per raider and
 * one entry per pull they were on. It exists because a night is not one state:
 * on a real report roughly half the roster is fed on some pulls and not others,
 * and a single tick-or-cross per raider has to pick a lie. So the fact stored
 * here is per pull, and the view decides how to fold it — a strip across the
 * night, or one honest answer when the officer scopes down to a single pull.
 *
 * **Nothing here is a new standard.** `prepared` is `isPrepared` — the same
 * flask-or-elixir-AND-food rule, read through the same policy, that feeds the
 * loot-priority factor and the standing board. Deriving a second definition of
 * the word on the way to the screen is the failure mode `preparation.ts`
 * exists to prevent (see change-chains §5a), so this module asks rather than
 * re-implements.
 *
 * Enchants, gems and item level ride along as **facts, deliberately unscored**.
 * They are worth reading beside the consumables and they are not part of what
 * the council decided "prepared" means; folding them in would silently re-rank
 * every raider's loot priority, which is a policy change and not this module's
 * to make.
 *
 * Pure, like the rest of this layer: rows in, view model out.
 */

/**
 * Gear-array indexes that count toward the item-level average.
 *
 * Shirt (3) and tabard (18) are worn, carry an item level, and say nothing
 * about how geared anyone is — averaging them in drags every raider down by
 * roughly the same wrong amount. `GEAR_SLOT_LABELS` already omits exactly those
 * two, so the list is read from there rather than written out again.
 */
const COUNTED_SLOTS = new Set(GEAR_SLOT_LABELS.map((s) => s.index));

/** Gear indexes a temporary weapon enchant can sit on, main hand first. */
const WEAPON_SLOTS = [
  { slot: 15, hand: "main" },
  { slot: 16, hand: "off" },
] as const;

/**
 * Average item level of the gear worn on a pull, or undefined when the pull
 * carried no gear snapshot (every report imported before gear tracking).
 *
 * One decimal, because whole numbers put half the roster on the same value.
 */
export function averageItemLevel(gear: WclPlayerFight["gear"]): number | undefined {
  const worn = gear.filter((g) => COUNTED_SLOTS.has(g.slot) && (g.ilvl ?? 0) > 0);
  if (worn.length === 0) return undefined;
  const total = worn.reduce((sum, g) => sum + (g.ilvl ?? 0), 0);
  return Math.round((total / worn.length) * 10) / 10;
}

/** Gear-array index → label, for naming a slot that changed hands. */
const SLOT_LABEL = new Map(GEAR_SLOT_LABELS.map((s) => [s.index, s.label] as const));

/**
 * What each slot held across the night, most-worn first.
 *
 * The raider's *usual* item is the one they wore on the most pulls — which is
 * the honest answer to "what are they geared in", and immune to the pull where
 * they were holding a fishing rod.
 */
function wornBySlot(rows: WclPlayerFight[]): Map<number, PreparednessWorn[]> {
  type Draft = Omit<PreparednessWorn, "encounters" | "tempEnchantIds"> & {
    seen: Map<string, number>;
    temps: Map<number, number>;
  };
  const bySlot = new Map<number, Map<number, Draft>>();
  for (const row of rows) {
    for (const g of row.gear) {
      const slot = bySlot.get(g.slot) ?? new Map<number, Draft>();
      bySlot.set(g.slot, slot);
      const worn = slot.get(g.id);
      const draft =
        worn ??
        ({
          itemId: g.id,
          ...(g.name !== undefined ? { name: g.name } : {}),
          ...(g.ilvl !== undefined ? { ilvl: g.ilvl } : {}),
          pulls: 0,
          seen: new Map<string, number>(),
          temps: new Map<number, number>(),
        } satisfies Draft);
      if (!worn) slot.set(g.id, draft);
      draft.pulls++;
      draft.seen.set(row.encounterName, (draft.seen.get(row.encounterName) ?? 0) + 1);
      if (g.temp !== undefined && g.temp > 0) {
        draft.temps.set(g.temp, (draft.temps.get(g.temp) ?? 0) + 1);
      }
    }
  }
  const rank = <T>(m: Map<T, number>): T[] => [...m].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const out = new Map<number, PreparednessWorn[]>();
  for (const [slot, items] of bySlot) {
    out.set(
      slot,
      [...items.values()]
        .sort((a, b) => b.pulls - a.pulls || compareText(a.name ?? "", b.name ?? ""))
        .map(({ seen, temps, ...worn }) => ({
          ...worn,
          encounters: rank(seen),
          tempEnchantIds: rank(temps),
        })),
    );
  }
  return out;
}

/**
 * Average item level over the raider's usual gear.
 *
 * Same slots as `averageItemLevel` (shirt and tabard out), but reading the
 * most-worn item per slot rather than one pull's snapshot — so a rod held for
 * one pull cannot answer for a whole night's gear.
 */
function representativeItemLevel(worn: Map<number, PreparednessWorn[]>): number | undefined {
  const ilvls: number[] = [];
  for (const [slot, items] of worn) {
    if (!COUNTED_SLOTS.has(slot)) continue;
    const usual = items[0];
    if (usual?.ilvl !== undefined && usual.ilvl > 0) ilvls.push(usual.ilvl);
  }
  if (ilvls.length === 0) return undefined;
  return Math.round((ilvls.reduce((a, b) => a + b, 0) / ilvls.length) * 10) / 10;
}

/** One raider's row of one pull, as the table reads it. */
function pullOf(row: WclPlayerFight, policy: GuildPolicy): PreparednessPull {
  const coverage = elixirCoverage(row);
  /*
   * Both hands. A rogue runs a different poison on each weapon, and a raider
   * who oiled one and forgot the other has done half the job — reading only
   * the main hand reported that as done.
   */
  const weaponEnchants = WEAPON_SLOTS.flatMap(({ slot, hand }) => {
    const temp = row.gear.find((g) => g.slot === slot)?.temp;
    return temp !== undefined && temp > 0 ? [{ hand, id: temp }] : [];
  });
  return {
    fightId: row.fightId,
    grade: coverage.grade,
    ...(coverage.missing !== undefined ? { missingSlot: coverage.missing } : {}),
    ...(row.flask !== undefined ? { flask: row.flask } : {}),
    elixirs: row.elixirs,
    // Read through `hasFood`, not `row.food`: a dish that applies its own buff
    // name (Skullfish Soup's "Enlightened") is recovered from `extras` at read
    // time, so curating one fixes reports imported before it was known.
    food: hasFood(row),
    scrolls: row.scrolls,
    weaponBuff: row.weaponBuff,
    weaponEnchants,
    enchanted: ENCHANTABLE_GEAR_SLOTS.length - row.missingEnchants.length,
    missingEnchants: row.missingEnchants,
    gems: row.gear.reduce((sum, g) => sum + g.gems.length, 0),
    ...(row.gear.length > 0 ? { hasGear: true } : {}),
    ...(() => {
      const ilvl = averageItemLevel(row.gear);
      return ilvl === undefined ? {} : { ilvl };
    })(),
    prepared: isPrepared(row, policy.preparation),
  };
}

/**
 * Fold a night's pet consumables into food and scrolls, most-used first.
 *
 * Returns undefined rather than empty lists: "nothing was logged for a pet" is
 * a different statement from "the pet went unfed", and only the first is one
 * this app can make — see `PreparednessRow.pet`.
 */
function petOf(offPull: WclPlayerOffPull | undefined): PreparednessPet | undefined {
  if (offPull === undefined || offPull.petConsumables.length === 0) return undefined;
  const food = new Map<string, number>();
  const scrolls = new Map<string, number>();
  for (const applied of offPull.petConsumables) {
    // Asked of the same curated list that named it, rather than pattern-matched
    // here — one source of truth, and a newly curated pet food files itself.
    const bucket = consumableGroupOf(applied.name) === "scroll" ? scrolls : food;
    bucket.set(applied.name, (bucket.get(applied.name) ?? 0) + 1);
  }
  const rank = (m: Map<string, number>): [string, number][] =>
    [...m].sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]));
  // Chronological. Rows imported before the timing have no clock, so they keep
  // the order the log listed them in rather than being sorted to the front.
  const applications = [...offPull.petConsumables].sort(
    (a, b) => (a.atMs ?? 0) - (b.atMs ?? 0),
  );
  return { food: rank(food), scrolls: rank(scrolls), applications };
}

export interface PreparednessInput {
  /** Pulls in scope — the caller has already dropped the ones the officer switched off. */
  rows: WclPlayerFight[];
  /** Lowercased actor name → roster slug, for deep-linking matched raiders. */
  slugByActor: Map<string, string>;
  /**
   * This report's off-pull records, which is where anything done to a pet
   * lives. Absent for a report imported before off-pull tracking.
   */
  offPull?: WclPlayerOffPull[];
  policy?: GuildPolicy;
}

/**
 * Fold pull rows into one row per raider, alphabetically.
 *
 * Alphabetical because the table is read to look somebody up as often as it is
 * read worst-first, and a name is the one order that never moves under the
 * reader. The column sorts are the view's business, not this module's.
 *
 * Note on excused encounters: `policy.preparation.excusedEncounters` is
 * deliberately NOT applied here. The raid page scopes a night with the pull
 * filter instead — which the caller has already applied — and the coverage
 * percentages in `RaidPrepStats` beside this table follow the same rule. The
 * excused list is for the career and standing rollups, where there is no
 * officer sitting in front of a pull list.
 */
export function buildPreparedness(input: PreparednessInput): PreparednessView {
  const policy = input.policy ?? DEFAULT_POLICY;
  const offPullByActor = new Map(
    (input.offPull ?? []).map((o) => [o.actorName.toLowerCase(), o] as const),
  );
  const byActor = new Map<string, WclPlayerFight[]>();
  for (const row of input.rows) {
    const list = byActor.get(row.actorName) ?? [];
    list.push(row);
    byActor.set(row.actorName, list);
  }

  const rows: PreparednessRow[] = [];
  for (const [actorName, playerRows] of byActor) {
    const ordered = [...playerRows].sort((a, b) => a.fightId - b.fightId);
    const latest = ordered[ordered.length - 1];
    rows.push({
      name: actorName,
      ...(input.slugByActor.get(actorName.toLowerCase()) !== undefined
        ? { slug: input.slugByActor.get(actorName.toLowerCase()) }
        : {}),
      ...(latest.className !== undefined ? { className: latest.className } : {}),
      ...(latest.spec !== undefined ? { spec: latest.spec } : {}),
      role: latest.role,
      pulls: ordered.map((row) => pullOf(row, policy)),
      ...(() => {
        const worn = wornBySlot(ordered);
        const ilvl = representativeItemLevel(worn);
        const weaponSwaps: PreparednessSwap[] = WEAPON_SLOTS.flatMap(({ slot }) => {
          const items = worn.get(slot);
          // One item all night is the norm and worth no words at all.
          if (items === undefined || items.length < 2) return [];
          return [{ label: SLOT_LABEL.get(slot) ?? `Slot ${slot}`, items }];
        });
        return { ...(ilvl === undefined ? {} : { ilvl }), weaponSwaps };
      })(),
      ...(() => {
        const pet = petOf(offPullByActor.get(actorName.toLowerCase()));
        return pet === undefined ? {} : { pet };
      })(),
    });
  }
  rows.sort((a, b) => compareText(a.name, b.name));

  return { rows, enchantSlots: ENCHANTABLE_GEAR_SLOTS.length };
}
