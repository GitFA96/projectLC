import { parsePriorityChain, type PriorityChain } from "@/lib/loot/priority-chain";

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
