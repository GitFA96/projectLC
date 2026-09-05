import { DatabaseSync } from "node:sqlite";
import {
  GROUP_COUNT,
  emptyBoard,
  isEmptyBoard,
  sanitizeBoard,
  type Board,
} from "@/lib/analysis/raid-planner";
/**
 * `raid_board:<code>` and `template_board`.
 *
 * A raid night's board is a seating plan over a roster the log already gives,
 * so an empty one is stored as nothing at all rather than as an empty board —
 * see `nothingToRemember`.
 */

const raidBoardKey = (code: string) => `raid_board:${code}`;

/**
 * The template's board — guild-wide, so no suffix, like
 * `loot_priority_weights`. Deliberately a different key from any raid's: a plan
 * for next Wednesday is not a record of a night that happened, and the two must
 * never be able to overwrite each other.
 */
const TEMPLATE_BOARD_KEY = "template_board";

export function getTemplateBoard(db: DatabaseSync): Board {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(TEMPLATE_BOARD_KEY) as
    | { value: string }
    | undefined;
  return readBoard(row?.value);
}

export function setTemplateBoard(db: DatabaseSync, comp: Board): void {
  const clean = sanitizeBoard(comp, { groups: comp.groups.length });
  if (nothingToRemember(clean)) {
    db.prepare("DELETE FROM meta WHERE key = ?").run(TEMPLATE_BOARD_KEY);
    return;
  }
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(TEMPLATE_BOARD_KEY, JSON.stringify(clean));
}

/*
 * The guild's own named rosters: `guild_roster:<id>`.
 *
 * Several, because a guild that runs a split has more than one roster at once.
 * One row each rather than one row holding a list, so two officers on two
 * rosters can't overwrite each other's work — the boards autosave, and a shared
 * row would make every save a full rewrite of every roster.
 *
 * The one rule that differs from every other board here: **an empty board
 * still gets a row.** A raid night's empty board means "never laid out", which
 * is worth nothing to store; a roster exists because somebody made and named
 * it, and deleting it on the first Clear would take the name with it.
 */

/** A report's saved board, or an empty board when none was written. */
export function getRaidBoard(db: DatabaseSync, code: string): Board {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(raidBoardKey(code)) as
    | { value: string }
    | undefined;
  return readBoard(row?.value);
}

/**
 * Parse a stored board, keeping the number of groups it was saved with.
 *
 * Group count is part of the record now — an officer who runs five groups
 * shouldn't reopen the page to three empty ones tacked on the end — so it comes
 * from the blob rather than from the eight a raid frame allows. A missing or
 * corrupt row reads as an empty board rather than throwing a page.
 */

/**
 * Is this board worth a row?
 *
 * Nobody placed *and* nothing else set. A board can be empty of raiders and
 * still carry work — five groups named for the assignments, or a bench of
 * planned slots — and dropping that because the groups happen to be empty would
 * lose an officer's setup the moment they cleared the board to start again.
 */
function nothingToRemember(comp: Board): boolean {
  return (
    isEmptyBoard(comp) &&
    !comp.groupNames?.some(Boolean) &&
    (comp.bench?.length ?? 0) === 0 &&
    comp.groups.length === GROUP_COUNT
  );
}

function readBoard(value: string | undefined): Board {
  if (!value) return emptyBoard();
  try {
    const parsed = JSON.parse(value) as { groups?: unknown };
    const groups = Array.isArray(parsed?.groups) ? parsed.groups.length : undefined;
    return sanitizeBoard(parsed, groups ? { groups } : {});
  } catch {
    return emptyBoard();
  }
}

/**
 * Persist a report's board (replaces the whole board). A board with
 * nobody on it deletes the row, so "never laid out" and "laid out, then
 * cleared" read the same — there is nothing to remember about an empty board.
 */
export function setRaidBoard(db: DatabaseSync, code: string, comp: Board): void {
  const clean = sanitizeBoard(comp, { groups: comp.groups.length });
  const key = raidBoardKey(code);
  if (nothingToRemember(clean)) {
    db.prepare("DELETE FROM meta WHERE key = ?").run(key);
    return;
  }
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, JSON.stringify(clean));
}

/* Per-character wowsims setup: the decoded export a raider's comparison runs
   against. Same meta-table pattern as prices, keyed by character slug — a
   build, a rotation and a buff set belong to one raider, not to the guild.
   Absent means that character has no sim configured yet. */
