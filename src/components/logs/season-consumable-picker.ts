import type { SeasonConsumableStat, SeasonConsumableUser } from "@/lib/types";
import { isGuildCharacter } from "@/lib/analysis/season";
import {
  CONSUMABLE_GROUP_LABELS,
  CONSUMABLE_GROUP_ORDER,
  POTION_PURPOSE_LABELS,
  POTION_PURPOSE_ORDER,
  consumableGroupOf,
  isRestrictedRestore,
  potionPurposeOf,
  type ConsumableGroup,
  type PotionPurpose,
} from "@/lib/wcl/consumables";

import { compareText } from "@/lib/sort";

/**
 * What the season consumable board can be pointed at, and how a selection turns
 * into rows. Pure and JSX-free — the board next door owns the rendering, this
 * owns the arithmetic (see `performance/graph-utils.ts` for the same split).
 *
 * A roll-up ("all potions", "all mana potions") is a predicate over labels
 * rather than a stored row, so the families stay derived from the one curated
 * list in `wcl/consumables.ts` instead of being duplicated as season data.
 */
export type Selection =
  | { kind: "all" }
  | { kind: "group"; group: ConsumableGroup }
  | { kind: "purpose"; purpose: PotionPurpose }
  | { kind: "restricted" }
  | { kind: "name"; name: string };

export const ALL_KEY = "all";
const RESTRICTED_KEY = "restricted";
const RESTRICTED_LABEL = "Vendor & rep restores";

export function keyOf(sel: Selection): string {
  switch (sel.kind) {
    case "all":
      return ALL_KEY;
    case "group":
      return `group:${sel.group}`;
    case "purpose":
      return `purpose:${sel.purpose}`;
    case "restricted":
      return RESTRICTED_KEY;
    case "name":
      return `name:${sel.name}`;
  }
}

export function parseKey(key: string): Selection {
  if (key === ALL_KEY) return { kind: "all" };
  if (key === RESTRICTED_KEY) return { kind: "restricted" };
  const [kind, ...rest] = key.split(":");
  // Rejoined, because a consumable name may contain the separator.
  const value = rest.join(":");
  if (kind === "group") return { kind: "group", group: value as ConsumableGroup };
  if (kind === "purpose") return { kind: "purpose", purpose: value as PotionPurpose };
  return { kind: "name", name: value };
}

/** Does this consumable belong to what the picker is pointed at? */
export function matches(sel: Selection, name: string): boolean {
  switch (sel.kind) {
    case "all":
      return true;
    case "group":
      return consumableGroupOf(name) === sel.group;
    case "purpose":
      return potionPurposeOf(name) === sel.purpose;
    case "restricted":
      return isRestrictedRestore(name);
    case "name":
      return name === sel.name;
  }
}

export interface UserRow extends SeasonConsumableUser {
  /** Uses per raid the player attended, to one decimal. */
  perRaid: number;
}

/**
 * Everyone who used the selected consumable(s), with their own totals.
 *
 * Merging across a roll-up sums per player — the same raider appears once for
 * "all potions" rather than once per potion. `raids` is the player's own count
 * and identical on every row they hold, so taking the largest is a max over
 * equal numbers rather than a guess.
 */
export function usersOf(
  stats: SeasonConsumableStat[],
  sel: Selection,
  guildOnly: boolean,
): UserRow[] {
  const merged = new Map<string, UserRow>();
  for (const stat of stats) {
    if (!matches(sel, stat.name)) continue;
    for (const u of stat.users) {
      if (guildOnly && !isGuildCharacter(u.status)) continue;
      const key = u.name.toLowerCase();
      const row = merged.get(key) ?? { ...u, uses: 0, gold: 0, perRaid: 0 };
      row.uses += u.uses;
      row.gold += u.gold;
      row.raids = Math.max(row.raids, u.raids);
      merged.set(key, row);
    }
  }
  return [...merged.values()].map((r) => ({
    ...r,
    perRaid: r.raids > 0 ? Math.round((r.uses / r.raids) * 10) / 10 : 0,
  }));
}

export interface OptionGroup {
  label: string;
  items: { key: string; label: string }[];
}

/**
 * The picker's contents, built from what these raids actually used — a family
 * nobody touched isn't offered, and neither is a potion sub-group with nothing
 * in it.
 */
export function buildOptions(consumables: SeasonConsumableStat[]): OptionGroup[] {
  const byGroup = new Map<ConsumableGroup, SeasonConsumableStat[]>();
  for (const c of consumables) {
    const g = consumableGroupOf(c.name);
    byGroup.set(g, [...(byGroup.get(g) ?? []), c]);
  }

  const groups: OptionGroup[] = [
    { label: "Everything", items: [{ key: ALL_KEY, label: "All consumables" }] },
  ];

  for (const group of CONSUMABLE_GROUP_ORDER) {
    const stats = byGroup.get(group);
    if (!stats || stats.length === 0) continue;
    const familyLabel = CONSUMABLE_GROUP_LABELS[group];
    const items = [
      { key: keyOf({ kind: "group", group }), label: `All ${familyLabel.toLowerCase()}` },
    ];

    if (group === "potion") {
      for (const purpose of POTION_PURPOSE_ORDER) {
        if (!stats.some((s) => potionPurposeOf(s.name) === purpose)) continue;
        items.push({
          key: keyOf({ kind: "purpose", purpose }),
          label: `${POTION_PURPOSE_LABELS[purpose]} potions`,
        });
      }
      // The vendor restores cut across mana and healing, and they're the row
      // worth seeing apart: fifty of them is not fifty Super Mana Potions.
      if (stats.some((s) => isRestrictedRestore(s.name))) {
        items.push({ key: RESTRICTED_KEY, label: RESTRICTED_LABEL });
      }
    }

    // Individually, most-used first — the order an officer scans in.
    for (const s of [...stats].sort((a, b) => b.uses - a.uses || compareText(a.name, b.name))) {
      items.push({ key: keyOf({ kind: "name", name: s.name }), label: s.name });
    }
    groups.push({ label: familyLabel, items });
  }

  return groups;
}
