import { DatabaseSync } from "node:sqlite";
import { sanitizeGuildRoster, type GuildRoster } from "@/lib/analysis/raid-planner";
import { compareText } from "@/lib/sort";
/**
 * `guild_roster:<id>` — the planning rosters that exist without a raid night.
 *
 * Prefix-scanned rather than listed, which is why the LIKE pattern escapes its
 * own underscore: unescaped, `guild_roster:%` also matches `guildXroster:`.
 */

const GUILD_ROSTER_PREFIX = "guild_roster:";

const guildRosterKey = (id: string) => `${GUILD_ROSTER_PREFIX}${id}`;

/*
 * `_` is a single-character wildcard in SQL LIKE, so the obvious
 * `LIKE 'guild_roster:%'` also matches `guildXroster:…`. Nothing writes such a
 * key today, which is exactly why this would go unnoticed if one ever did.
 */
const GUILD_ROSTER_LIKE = "guild\\_roster:%";

/** Every guild roster, oldest first — the order the picker shows them in. */
export function listGuildRosters(db: DatabaseSync): GuildRoster[] {
  const rows = db
    .prepare("SELECT value FROM meta WHERE key LIKE ? ESCAPE '\\'")
    .all(GUILD_ROSTER_LIKE) as { value: string }[];
  return rows
    .map((r) => readGuildRoster(r.value))
    .filter((b): b is GuildRoster => b !== undefined)
    .sort((a, b) => compareText(a.createdAt, b.createdAt) || compareText(a.id, b.id));
}

export function getGuildRoster(db: DatabaseSync, id: string): GuildRoster | undefined {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(guildRosterKey(id)) as
    | { value: string }
    | undefined;
  return readGuildRoster(row?.value);
}

function readGuildRoster(value: string | undefined): GuildRoster | undefined {
  if (!value) return undefined;
  try {
    return sanitizeGuildRoster(JSON.parse(value));
  } catch {
    return undefined;
  }
}

export function setGuildRoster(db: DatabaseSync, board: GuildRoster): void {
  const clean = sanitizeGuildRoster(board);
  if (!clean) throw new Error("A roster needs an id and a name.");
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(guildRosterKey(clean.id), JSON.stringify(clean));
}

/**
 * Change part of a board, leaving the rest alone.
 *
 * Read-modify-write inside the caller's transaction, because the three things a
 * board holds are edited by three different controls: the board
 * autosaves as an officer drags, the name as they type it, the prospects when
 * they add one. A blind full write from any of those would drop the other two.
 *
 * A board that has been deleted is not resurrected — the officer who deleted it
 * meant it, and the autosave still in flight from another tab did not.
 */
export function updateGuildRoster(
  db: DatabaseSync,
  id: string,
  patch: Partial<Pick<GuildRoster, "name" | "prospects" | "board">>,
): void {
  const existing = getGuildRoster(db, id);
  if (!existing) return;
  setGuildRoster(db, { ...existing, ...patch });
}

export function deleteGuildRoster(db: DatabaseSync, id: string): void {
  db.prepare("DELETE FROM meta WHERE key = ?").run(guildRosterKey(id));
}
