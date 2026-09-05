import { DatabaseSync } from "node:sqlite";
/**
 * `sheet_item_ids`, the per-phase priority sheets, and the per-item rules an
 * officer writes against them.
 *
 * Rules are scoped by phase: the same item can be a different call in Karazhan
 * and in Sunwell, and a rule written for one must not follow the item forward.
 */

const SHEET_ITEM_IDS_KEY = "sheet_item_ids";

/**
 * Item ids an officer pinned to a name the priority sheet uses.
 *
 * The sheet is written in names and everything else here is keyed by id, so a
 * name Wowhead can't identify renders as bare text — no icon, no hover — on the
 * page officers read while deciding a drop. Most are closed automatically by
 * exact-name lookup; these are the ones that can't be:
 *
 *  - Two items share a name exactly. Both Warglaives of Azzinoth are called
 *    "Warglaive of Azzinoth", and the sheet tells them apart with "(Main Hand)"
 *    — an annotation no index can resolve. Only a person knows which is which.
 *  - The sheet's spelling is simply not the item's, and correcting the document
 *    isn't wanted.
 *
 * Guild-wide and keyed by the normalized name, so it survives the sheet being
 * re-pasted — which is the whole point: an officer should not have to redo this
 * every phase.
 */
export function getSheetItemIds(db: DatabaseSync): Record<string, number> {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(SHEET_ITEM_IDS_KEY) as
    | { value: string }
    | undefined;
  if (!row) return {};
  try {
    const raw = JSON.parse(row.value) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "number" && Number.isInteger(value) && value > 0) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/** Pin one name to an item id, or unpin it with `undefined`. */
export function setSheetItemId(db: DatabaseSync, key: string, itemId?: number): void {
  const current = getSheetItemIds(db);
  if (itemId === undefined) delete current[key];
  else current[key] = itemId;
  if (Object.keys(current).length === 0) {
    db.prepare("DELETE FROM meta WHERE key = ?").run(SHEET_ITEM_IDS_KEY);
    return;
  }
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(SHEET_ITEM_IDS_KEY, JSON.stringify(current));
}

export interface StoredPriorityRule {
  itemName: string;
  chain: string;
  note?: string;
}

/**
 * Every officer-edited chain, by phase and then normalized item name.
 *
 * Nested rather than flat-keyed on `"phase|name"`: the sheet page wants one
 * phase's chains whole, and a single-drop lookup walks the phases in order,
 * so both callers want a phase's worth at a time.
 */
export function getItemPriorityRules(db: DatabaseSync): Record<number, Record<string, StoredPriorityRule>> {
  const rows = db.prepare("SELECT item_key, phase, item_name, chain, note FROM item_priority_rules").all() as {
    item_key: string;
    phase: number;
    item_name: string;
    chain: string;
    note: string | null;
  }[];
  const out: Record<number, Record<string, StoredPriorityRule>> = {};
  for (const r of rows) {
    (out[r.phase] ??= {})[r.item_key] = {
      itemName: r.item_name,
      chain: r.chain,
      note: r.note ?? undefined,
    };
  }
  return out;
}

export function setItemPriorityRule(
  db: DatabaseSync,
  itemKey: string,
  phase: number,
  rule: StoredPriorityRule,
): void {
  db.prepare(
    `INSERT INTO item_priority_rules (item_key, phase, item_name, chain, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(item_key, phase) DO UPDATE SET
       item_name = excluded.item_name, chain = excluded.chain,
       note = excluded.note, updated_at = excluded.updated_at`,
  ).run(itemKey, phase, rule.itemName, rule.chain, rule.note ?? null, new Date().toISOString());
}

/** One phase's chain for an item, or undefined when that phase has none. */
export function getItemPriorityRuleAt(
  db: DatabaseSync,
  itemKey: string,
  phase: number,
): StoredPriorityRule | undefined {
  const row = db
    .prepare("SELECT item_name, chain, note FROM item_priority_rules WHERE item_key = ? AND phase = ?")
    .get(itemKey, phase) as { item_name: string; chain: string; note: string | null } | undefined;
  return row ? { itemName: row.item_name, chain: row.chain, note: row.note ?? undefined } : undefined;
}

/** Re-file a chain under another phase, keeping the text and the note as written. */
export function moveItemPriorityRule(
  db: DatabaseSync,
  itemKey: string,
  fromPhase: number,
  toPhase: number,
): void {
  db.prepare("UPDATE item_priority_rules SET phase = ? WHERE item_key = ? AND phase = ?").run(
    toPhase,
    itemKey,
    fromPhase,
  );
}

/**
 * Drop one phase's override so that phase's sheet takes the item back.
 *
 * Phase-scoped on purpose: clearing a chain on the P2 page must not silently
 * throw away the different chain an officer wrote for the same item in P3.
 */
export function deleteItemPriorityRule(db: DatabaseSync, itemKey: string, phase: number): boolean {
  return (
    Number(
      db.prepare("DELETE FROM item_priority_rules WHERE item_key = ? AND phase = ?").run(itemKey, phase).changes,
    ) > 0
  );
}

/** A pasted sheet, as stored. The markdown is kept verbatim, never pre-parsed. */
export interface StoredPrioritySheet {
  markdown: string;
  author?: string;
  note?: string;
  updatedAt: string;
}

/** Every pasted sheet, keyed by phase. Phases with none are simply absent. */
export function getPrioritySheets(db: DatabaseSync): Record<number, StoredPrioritySheet> {
  const rows = db
    .prepare("SELECT phase, markdown, author, note, updated_at FROM priority_sheets")
    .all() as {
    phase: number;
    markdown: string;
    author: string | null;
    note: string | null;
    updated_at: string;
  }[];
  const out: Record<number, StoredPrioritySheet> = {};
  for (const r of rows) {
    out[r.phase] = {
      markdown: r.markdown,
      author: r.author ?? undefined,
      note: r.note ?? undefined,
      updatedAt: r.updated_at,
    };
  }
  return out;
}

export function setPrioritySheet(
  db: DatabaseSync,
  phase: number,
  sheet: { markdown: string; author?: string; note?: string },
): void {
  db.prepare(
    `INSERT INTO priority_sheets (phase, markdown, author, note, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(phase) DO UPDATE SET
       markdown = excluded.markdown, author = excluded.author,
       note = excluded.note, updated_at = excluded.updated_at`,
  ).run(phase, sheet.markdown, sheet.author ?? null, sheet.note ?? null, new Date().toISOString());
}

/** Drop a pasted sheet, handing the phase back to the seed (or to empty). */
export function deletePrioritySheet(db: DatabaseSync, phase: number): boolean {
  return Number(db.prepare("DELETE FROM priority_sheets WHERE phase = ?").run(phase).changes) > 0;
}
