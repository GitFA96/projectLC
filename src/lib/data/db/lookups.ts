import { DatabaseSync } from "node:sqlite";
import type { AbilityInfo } from "@/lib/items/ability-data";
import { type Row } from "@/lib/data/db/core";
/**
 * Caches of what somebody else's data source said: ability names, enchant
 * names, and the item names a lookup has already refused.
 *
 * The refusals are the interesting half. An id that resolved to nothing is
 * recorded so the next run does not ask again, and dropped once nothing
 * references that spelling — see change-chains §4f2.
 */

export function getAbilities(db: DatabaseSync): AbilityInfo[] {
  return (
    db.prepare("SELECT kind, id, name, icon, description, use_spell_id FROM abilities").all() as Row[]
  ).map((r) => ({
    kind: r.kind === "item" ? "item" : "spell",
    id: Number(r.id),
    name: String(r.name),
    icon: (r.icon as string | null) ?? undefined,
    description: (r.description as string | null) ?? undefined,
    useSpellId: (r.use_spell_id as number | null) ?? undefined,
  }));
}

/** Record resolved abilities. Refs already known are left alone. */
export function addAbilities(db: DatabaseSync, abilities: AbilityInfo[]): number {
  const stmt = db.prepare(
    `INSERT INTO abilities (kind, id, name, icon, description, use_spell_id, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(kind, id) DO NOTHING`,
  );
  const now = new Date().toISOString();
  let written = 0;
  for (const a of abilities) {
    if (!Number.isFinite(a.id) || a.id <= 0 || !a.name) continue;
    written += Number(
      stmt.run(a.kind, a.id, a.name, a.icon ?? null, a.description ?? null, a.useSpellId ?? null, now)
        .changes,
    );
  }
  return written;
}

/*
 * Sim setups belong to a class and spec, not to a raider.
 *
 * A wowsims export supplies the rotation, the buffs and the consumables a spec
 * is expected to run; the gear, the talents and the fight length come from the
 * pull instead. Almost none of that is personal, so keying it per character —
 * the `sim_settings:<slug>` rows this replaced — meant every raider needed their
 * own pasted link before they could be simmed at all. Whatever IS personal, like
 * race and professions, is stated as an assumption by the pre-run check rather
 * than silently applied. See src/lib/sim/profile.ts.
 */

/** Every enchant id the app has resolved a name for. */
export function getEnchantNames(db: DatabaseSync): Record<number, string> {
  const rows = db.prepare("SELECT id, name FROM enchant_names").all() as {
    id: number;
    name: string;
  }[];
  const out: Record<number, string> = {};
  for (const r of rows) out[r.id] = r.name;
  return out;
}

/**
 * Record resolved enchant names. A name already known is left alone: the first
 * one recorded is as good as any later one, and nothing should churn.
 */
export function addEnchantNames(db: DatabaseSync, names: { id: number; name: string }[]): number {
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO enchant_names (id, name, resolved_at) VALUES (?, ?, ?)",
  );
  const at = new Date().toISOString();
  let written = 0;
  for (const { id, name } of names) {
    if (!Number.isInteger(id) || id <= 0 || !name.trim()) continue;
    written += Number(stmt.run(id, name.trim(), at).changes);
  }
  return written;
}

/** One name Wowhead was asked about and would not identify. */
export interface RefusedItemName {
  nameKey: string;
  name: string;
  reason: string;
  near: string[];
  checkedAt: string;
}

/** Every name the app has asked about and been refused. */
export function getRefusedItemNames(db: DatabaseSync): RefusedItemName[] {
  const rows = db
    .prepare("SELECT name_key, name, reason, near, checked_at FROM item_name_lookups")
    .all() as { name_key: string; name: string; reason: string; near: string; checked_at: string }[];
  return rows.map((r) => ({
    nameKey: r.name_key,
    name: r.name,
    reason: r.reason,
    near: parseNear(r.near),
    checkedAt: r.checked_at,
  }));
}

/** A malformed blob is nothing offered, never a thrown read. */
function parseNear(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Record names Wowhead refused, replacing any earlier verdict on the same name.
 *
 * Replacing rather than ignoring: a re-ask is how an officer checks whether a
 * fixed sheet row now resolves, and the newer answer is the true one. Callers
 * must filter out transport errors before getting here — see the table comment.
 */
export function recordRefusedItemNames(
  db: DatabaseSync,
  refused: { nameKey: string; name: string; reason: string; near: string[] }[],
): number {
  const stmt = db.prepare(
    `INSERT INTO item_name_lookups (name_key, name, reason, near, checked_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(name_key) DO UPDATE SET
       name = excluded.name, reason = excluded.reason,
       near = excluded.near, checked_at = excluded.checked_at`,
  );
  const at = new Date().toISOString();
  let written = 0;
  for (const r of refused) {
    if (!r.nameKey.trim() || !r.name.trim()) continue;
    written += Number(stmt.run(r.nameKey, r.name.trim(), r.reason, JSON.stringify(r.near), at).changes);
  }
  return written;
}

/**
 * Forget past refusals, so the ordinary queue offers those names again.
 *
 * With no keys, forgets all of them — the "look at these again" press after a
 * sheet has been corrected or a curated label has moved.
 */
export function clearRefusedItemNames(db: DatabaseSync, nameKeys?: string[]): number {
  if (nameKeys === undefined) {
    return Number(db.prepare("DELETE FROM item_name_lookups").run().changes);
  }
  const stmt = db.prepare("DELETE FROM item_name_lookups WHERE name_key = ?");
  let removed = 0;
  for (const key of nameKeys) removed += Number(stmt.run(key).changes);
  return removed;
}

/* Entity <-> row mapping. SQLite has no undefined: optionals become NULL and
   are stripped again on load so zod sees exactly the canonical shapes. */
