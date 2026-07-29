import { GEAR_SLOT_IDS, GEAR_SLOT_LABELS } from "@/lib/wcl/enchants";
import type { Quality, SlotId, WclPlayerFight } from "@/lib/types";

/**
 * What a raider actually wore, summarised per slot.
 *
 * An imported SixtyUpgrades set is one snapshot of intent: the gear they had
 * on the day they exported it. The logs are the opposite — Warcraft Logs
 * records the worn set on every pull, and in TBC that differs per boss: resist
 * pieces for one fight, a threat trinket while tanking, the shield that only
 * comes out on Hydross. A single "current gear" row can't represent that
 * honestly.
 *
 * So a slot here is a *list*: every item seen in it across the raid nights in
 * scope, most recently worn first, with how many pulls and which bosses. The
 * enchant and gems ride along from the most recent pull that item was worn on
 * — not to be printed, but so the item's Wowhead tooltip renders it exactly as
 * it was worn, re-enchants and regems included.
 */

/** One report's pulls for this character, newest report first. */
export interface LoggedGearReport {
  report: { code: string; title: string; zone?: string; startTime: string };
  rows: WclPlayerFight[];
}

/** One item seen in a slot, with the evidence behind it. */
export interface LoggedGearOption {
  itemId: number;
  name?: string;
  icon?: string;
  quality?: Quality;
  ilvl?: number;
  /** Enchant and gems as of the most recent pull this item was worn on — tooltip fodder. */
  enchantId?: number;
  gems: { id: number; icon?: string }[];
  /** Pulls (within scope) this item was worn for. */
  pulls: number;
  /** Bosses it was worn on, most pulls first: [name, pulls]. */
  encounters: [string, number][];
  /** The report + boss of the most recent pull wearing it. */
  lastSeen: { code: string; startTime: string; encounterName: string };
  /** True for the item worn on the most recent pull — the best "right now" answer. */
  current: boolean;
}

export interface LoggedGearSlot {
  /** WCL gear-array index. */
  index: number;
  label: string;
  /** The wishlist slot id, where one maps (shirt/tabard don't). */
  slot?: SlotId;
  /** Pulls in scope where this slot held anything — the denominator for a share. */
  slotPulls: number;
  /** Most recently worn first. */
  options: LoggedGearOption[];
}

export interface LoggedGearView {
  /** Pulls in scope that carried a gear snapshot. */
  pulls: number;
  /** The reports counted, newest first. */
  reports: { code: string; title: string; zone?: string; startTime: string; pulls: number }[];
  slots: LoggedGearSlot[];
}

interface Draft extends Omit<LoggedGearOption, "encounters" | "reportCodes" | "current"> {
  /** Recency rank of the most recent pull wearing it — 0 is the newest pull in scope. */
  rank: number;
  encounters: Map<string, number>;
}

const SLOT_LABELS = new Map(GEAR_SLOT_LABELS.map((s) => [s.index, s.label] as const));

/**
 * Fold per-pull gear snapshots into per-slot options.
 *
 * `reports` must be newest first (as the performance bundle hands them over);
 * `limit` caps how many raid nights count — enough history to catch a swap
 * set, recent enough that retired gear doesn't linger.
 */
export function buildLoggedGear(
  reports: LoggedGearReport[],
  opts: { limit?: number } = {},
): LoggedGearView {
  const scope = reports.slice(0, opts.limit ?? 3);
  /** slot index → item id → draft. */
  const bySlot = new Map<number, Map<number, Draft>>();
  const counted: LoggedGearView["reports"] = [];
  let rank = 0;
  let pulls = 0;

  for (const { report, rows } of scope) {
    // Newest pull of the night first, so `rank` only ever counts backwards.
    const ordered = [...rows].sort((a, b) => b.fightId - a.fightId);
    let reportPulls = 0;
    for (const row of ordered) {
      if (row.gear.length === 0) continue;
      const pullRank = rank++;
      pulls++;
      reportPulls++;
      for (const g of row.gear) {
        const slot = bySlot.get(g.slot) ?? new Map<number, Draft>();
        bySlot.set(g.slot, slot);
        const seen = slot.get(g.id);
        if (!seen) {
          slot.set(g.id, {
            itemId: g.id,
            name: g.name,
            icon: g.icon,
            quality: g.quality,
            ilvl: g.ilvl,
            enchantId: g.enchant,
            gems: g.gems,
            pulls: 1,
            rank: pullRank,
            encounters: new Map([[row.encounterName, 1]]),
            lastSeen: {
              code: report.code,
              startTime: report.startTime,
              encounterName: row.encounterName,
            },
          });
          continue;
        }
        seen.pulls++;
        seen.encounters.set(row.encounterName, (seen.encounters.get(row.encounterName) ?? 0) + 1);
        // Older pulls only ever add counts — the newest reading stands.
        seen.ilvl ??= g.ilvl;
        seen.name ??= g.name;
        seen.icon ??= g.icon;
        seen.quality ??= g.quality;
      }
    }
    if (reportPulls > 0) counted.push({ ...report, pulls: reportPulls });
  }

  const slots: LoggedGearSlot[] = [];
  for (const { index } of GEAR_SLOT_LABELS) {
    const drafts = bySlot.get(index);
    if (!drafts || drafts.size === 0) continue;
    const options = [...drafts.values()]
      .sort((a, b) => a.rank - b.rank || b.pulls - a.pulls)
      .map((draft, i) => {
        const { rank, encounters, ...option } = draft;
        void rank; // ordering only — callers get recency from `current`/`lastSeen`
        return {
          ...option,
          encounters: [...encounters].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
          current: i === 0,
        };
      });
    slots.push({
      index,
      label: SLOT_LABELS.get(index) ?? `Slot ${index}`,
      slot: GEAR_SLOT_IDS[index],
      slotPulls: options.reduce((sum, o) => sum + o.pulls, 0),
      options,
    });
  }

  return { pulls, reports: counted, slots };
}

/** "Gruul ×4 · High King Maulgar ×2" — the evidence line for one option. */
export function encounterSummary(option: LoggedGearOption): string {
  return option.encounters.map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(" · ");
}
