import { parsePriorityChain, type PriorityChain } from "@/lib/loot/priority-chain";
import type { Quality } from "@/lib/types";

import { compareText } from "@/lib/sort";

/**
 * The council's written sheet, read straight out of its markdown.
 *
 * Parsing the document instead of storing pre-chewed rows keeps the seed file
 * something a human owns: replacing next phase's sheet is a paste, and the
 * source of every rule is one grep away. Rules are keyed by ITEM NAME, not id —
 * a sheet lists everything a boss can drop, most of which the item cache has
 * never heard of because nobody has won or wishlisted it yet.
 */

export interface PrioritySheetRule {
  /** Boss / section heading the row sat under. */
  source: string;
  itemName: string;
  chain: PriorityChain;
  /** The sheet's own slot wording ("Plate - Waist"), which is finer than ours. */
  slotLabel?: string;
  note?: string;
}

/** Item names are compared loosely — punctuation and case drift between sources. */
export function normalizeItemName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const cell = (s: string) => s.trim();

/**
 * Pull every `| Item | Priority | Slot | Notes |` row out of the markdown,
 * remembering the `###` heading each was found under. Anything that isn't a
 * four-column data row — headings, separators, the notation blurb — is skipped
 * rather than guessed at.
 */
export function parsePrioritySheet(markdown: string): PrioritySheetRule[] {
  const rules: PrioritySheetRule[] = [];
  let section = "";
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^#{2,4}\s+(.*)$/.exec(line);
    if (heading) {
      section = heading[1].trim();
      continue;
    }
    if (!line.startsWith("|")) continue;
    const cells = line.slice(1, line.endsWith("|") ? -1 : undefined).split("|").map(cell);
    if (cells.length < 2) continue;
    // Header row and the |---|---| separator under it.
    if (/^:?-{2,}:?$/.test(cells[0]) || cells[0].toLowerCase() === "item") continue;
    const [itemName, priority, slotLabel, note] = cells;
    if (!itemName || !priority) continue;
    rules.push({
      source: section,
      itemName,
      chain: parsePriorityChain(priority),
      slotLabel: slotLabel || undefined,
      note: note || undefined,
    });
  }
  return rules;
}

/** Rules indexed by normalized name, first occurrence winning. */
export function indexRules(rules: PrioritySheetRule[]): Map<string, PrioritySheetRule> {
  const byName = new Map<string, PrioritySheetRule>();
  for (const rule of rules) {
    const key = normalizeItemName(rule.itemName);
    if (!byName.has(key)) byName.set(key, rule);
  }
  return byName;
}

/* ---- Reading the whole sheet, rather than one item at a time ---- */

/** One row of the sheet as it stands — the sheet's rule with any edit on top. */
export interface PrioritySheetViewRow {
  itemName: string;
  /** The chain actually in force. */
  chain: string;
  tiers: PriorityChain["tiers"];
  origin: "sheet" | "officer";
  /** What the sheet itself says, present only when an officer overrode it. */
  sheetChain?: string;
  slotLabel?: string;
  note?: string;
  /** Set when the item cache knows the name, so the row can link to the item. */
  itemId?: number;
  /**
   * Enough of the cached item to render it the way every other list does —
   * icon, quality colour, Wowhead hover. Filled by the read model after this
   * builder has run, so the builder stays pure and name-only.
   */
  quality?: Quality;
  icon?: string;
  /**
   * The phase the item cache says this drop belongs to, when it knows one.
   * Filled by the read model beside `quality`, and worth carrying separately
   * from the sheet's own phase: the two disagreeing is how a chain ends up
   * filed against a tier its item doesn't drop in.
   */
  itemPhase?: number;
  /**
   * An earlier row already claimed this name, so matching never reaches this
   * one. Shown rather than dropped: a pasted sheet that lists an item twice
   * should say so, not quietly hide a row an officer went looking for.
   */
  shadowed?: boolean;
}

/** Rows under the heading they were written under — the boss, usually. */
export interface PrioritySheetSection {
  source: string;
  rows: PrioritySheetViewRow[];
}

export interface PrioritySheetView {
  sections: PrioritySheetSection[];
  /**
   * Chains an officer wrote for items the sheet never listed. They're in force
   * exactly like the rest, so leaving them off would make this page a lie about
   * what the council is actually applying.
   */
  unlisted: PrioritySheetViewRow[];
  /** Rows in the sheet, shadowed ones included. */
  ruleCount: number;
  /** How many chains an officer has edited or added. */
  officerCount: number;
}

/**
 * A phase's sheet with its provenance — the view plus where the text came from.
 *
 * The provenance is not decoration: "seed" and "pasted" mean different things
 * when an officer is deciding whether to overwrite, and "none" is the honest
 * answer for a phase nobody has written a sheet for yet.
 */
export interface PrioritySheetDocument extends PrioritySheetView {
  phase: number;
  origin: "seed" | "pasted" | "none";
  /** When the sheet was pasted. Absent for the seeded one. */
  updatedAt?: string;
  /** Who pasted it — free text, since there is no auth. */
  author?: string;
  /** The officer's note about this paste, distinct from any row's note. */
  sheetNote?: string;
  /** The markdown itself, so the editor can open on what is in force. */
  markdown: string;
}

export interface PrioritySheetViewInput {
  /** Parsed sheet, in document order. */
  rules: PrioritySheetRule[];
  /** Officer edits, keyed by normalized item name. */
  overrides: Record<string, { itemName: string; chain: string; note?: string }>;
  /** Resolves a sheet name to an item id, when the cache has heard of it. */
  itemIdFor?: (itemName: string) => number | undefined;
}

/**
 * The whole sheet as one readable document, with edits folded in.
 *
 * The per-item lookup answers "what applies to this drop"; this answers "what
 * does our sheet actually say", which is the question you can't ask anywhere
 * else — most of the sheet covers items nobody has wishlisted or won yet, so
 * the item pages that would show them don't exist.
 *
 * Sections keep the document's own order and headings. Pure.
 */
export function buildPrioritySheetView(input: PrioritySheetViewInput): PrioritySheetView {
  const { rules, overrides, itemIdFor } = input;
  const sections = new Map<string, PrioritySheetViewRow[]>();
  const seen = new Set<string>();
  const usedOverrides = new Set<string>();

  for (const rule of rules) {
    const key = normalizeItemName(rule.itemName);
    const override = overrides[key];
    if (override) usedOverrides.add(key);
    const shadowed = seen.has(key);
    seen.add(key);

    const row: PrioritySheetViewRow = override
      ? {
          itemName: rule.itemName,
          chain: override.chain,
          tiers: parsePriorityChain(override.chain).tiers,
          origin: "officer",
          sheetChain: rule.chain.source,
          slotLabel: rule.slotLabel,
          note: override.note ?? rule.note,
          itemId: itemIdFor?.(rule.itemName),
          shadowed: shadowed || undefined,
        }
      : {
          itemName: rule.itemName,
          chain: rule.chain.source,
          tiers: rule.chain.tiers,
          origin: "sheet",
          slotLabel: rule.slotLabel,
          note: rule.note,
          itemId: itemIdFor?.(rule.itemName),
          shadowed: shadowed || undefined,
        };

    const rows = sections.get(rule.source) ?? [];
    rows.push(row);
    sections.set(rule.source, rows);
  }

  const unlisted = Object.entries(overrides)
    .filter(([key]) => !usedOverrides.has(key))
    .map(([, o]) => ({
      itemName: o.itemName,
      chain: o.chain,
      tiers: parsePriorityChain(o.chain).tiers,
      origin: "officer" as const,
      note: o.note,
      itemId: itemIdFor?.(o.itemName),
    }))
    .sort((a, b) => compareText(a.itemName, b.itemName));

  return {
    sections: [...sections].map(([source, rows]) => ({ source, rows })),
    unlisted,
    ruleCount: rules.length,
    officerCount: usedOverrides.size + unlisted.length,
  };
}
