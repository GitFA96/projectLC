"use server";

import { z } from "zod";
import {
  GROUP_COUNT,
  GROUP_SIZE,
  newGuildRoster,
  nextRosterName,
  sanitizeBoard,
  sanitizeProspects,
} from "@/lib/analysis/raid-planner";
import { getWriteRepo } from "@/lib/data/repo";
import { refreshAfterWrite } from "@/lib/refresh";
import { requireCapability } from "@/lib/auth/can";
import { resolveViewer } from "@/lib/auth/viewer";

/**
 * Saving a board.
 *
 * Three places a board can live, and they are kept rigorously apart:
 *
 *  - **A raid night** (`{kind: "raid"}`) — the record of how that raid was
 *    actually grouped. One per report code, never shared with another night.
 *  - **The template** (`{kind: "template"}`) — one per guild, an anonymous
 *    shape made of classes and specs rather than people.
 *  - **A guild roster** (`{kind: "roster"}`) — one of the guild's own named
 *    rosters, built from real raiders. As many as the officers want.
 *
 * The board autosaves, so this runs as an officer drags people around rather
 * than once at the end. That is why the repo's board writes skip
 * `bumpDataVersion` — nothing derived reads a board, so the rebuild it forces
 * would be pure latency. See sqlite-repo/planner.ts.
 */

const slotSchema = z.object({
  name: z.string().min(1).max(60),
  /** Which of the raider's specs the board counts them as; absent = their own. */
  spec: z.string().min(1).max(60).optional(),
  /** Set only on template slots, where the name isn't unique — see `slotKey`. */
  id: z.string().min(1).max(60).optional(),
  /** The officer's own name for the slot. */
  label: z.string().min(1).max(40).optional(),
});

/*
 * "roster" means a *guild roster* here. It used to mean the template, back when
 * the template tab was called the roster planner — so a stale caller passing
 * `{kind: "roster"}` with no id now fails the union rather than quietly writing
 * one record into the other. That is the whole reason the id is required, and
 * why the swap was safe to make at all.
 */
const targetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("raid"), code: z.string().min(1) }),
  z.object({ kind: z.literal("template") }),
  z.object({ kind: z.literal("roster"), id: z.string().min(1) }),
]);

const boardSchema = z.object({
  target: targetSchema,
  groups: z.array(z.array(slotSchema).max(GROUP_SIZE)).min(1).max(GROUP_COUNT),
  /** Officer names per group; a blank entry means "Group N". */
  groupNames: z.array(z.string().max(40).optional()).max(GROUP_COUNT).optional(),
  /** Slots set aside. Only template boards keep one; a raid night derives it. */
  bench: z.array(slotSchema).max(200).optional(),
});

export type BoardTarget = z.infer<typeof targetSchema>;
export type SaveBoardInput = z.infer<typeof boardSchema>;
export type SaveBoardResult = { ok: boolean; message: string };

/** Record a board. An empty one clears whatever was saved for that target. */
export async function saveBoard(input: SaveBoardInput): Promise<SaveBoardResult> {
  const parsed = boardSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That board doesn't look valid." };
  try {
    requireCapability(await resolveViewer(), "raid.plan");
    const repo = await getWriteRepo();
    // Sanitized again server-side: the board validating first is a convenience,
    // not a guarantee, and a duplicated name would have somebody buffing two
    // groups at once.
    const { target, groups, groupNames, bench } = parsed.data;
    // The board's own group count, not the eight a raid frame allows: an
    // officer who runs five groups must not reopen the page to three empty
    // ones tacked on the end.
    const board = sanitizeBoard({ groups, groupNames, bench }, { groups: groups.length });
    if (target.kind === "raid") {
      await repo.setRaidBoard(target.code, board);
      refreshAfterWrite("/logs");
    } else if (target.kind === "roster") {
      // Patch, not replace: the same row carries the roster's name and its
      // prospects, and those are edited by controls that don't run through here.
      await repo.updateGuildRoster(target.id, { board });
      refreshAfterWrite("/raid-planner");
    } else {
      await repo.setTemplateBoard(board);
      refreshAfterWrite("/raid-planner");
    }
    const placed = board.groups.flat().length;
    return {
      ok: true,
      message: placed === 0 ? "Board cleared." : `Saved — ${placed} placed.`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not save the board." };
  }
}

/* ------------------------------------------------ managing the guild's rosters */

export type RosterResult = { ok: boolean; message: string; id?: string };

/**
 * Make a new guild roster.
 *
 * The id is minted here rather than in the pure layer, and it is a uuid rather
 * than the name: officers rename these ("Wednesday" becomes "Split A"), and a
 * name-derived key would either strand the board under its old id or need a
 * rewrite of the row every time somebody edits a letter.
 */
export async function createGuildRoster(name?: string): Promise<RosterResult> {
  try {
    requireCapability(await resolveViewer(), "raid.plan");
    const repo = await getWriteRepo();
    const existing = await repo.listGuildRosters();
    const board = newGuildRoster(
      crypto.randomUUID(),
      name?.trim() || nextRosterName(existing),
      new Date().toISOString(),
    );
    await repo.createGuildRoster(board);
    refreshAfterWrite("/raid-planner");
    return { ok: true, message: `Created ${board.name}.`, id: board.id };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not create that roster." };
  }
}

export async function renameGuildRoster(id: string, name: string): Promise<RosterResult> {
  const clean = name.trim().slice(0, 40);
  if (!clean) return { ok: false, message: "A roster needs a name." };
  try {
    requireCapability(await resolveViewer(), "raid.plan");
    const repo = await getWriteRepo();
    await repo.updateGuildRoster(id, { name: clean });
    refreshAfterWrite("/raid-planner");
    return { ok: true, message: "Renamed.", id };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not rename that roster." };
  }
}

/**
 * Throw a roster away.
 *
 * Allowed, where deleting a raid night's board is not: invariant 6 protects
 * history, and a plan for a raid that hasn't happened is not history. Nothing
 * else references a board, so there is nothing to unlink.
 */
export async function deleteGuildRoster(id: string): Promise<RosterResult> {
  try {
    requireCapability(await resolveViewer(), "raid.plan");
    const repo = await getWriteRepo();
    await repo.deleteGuildRoster(id);
    refreshAfterWrite("/raid-planner");
    return { ok: true, message: "Roster deleted." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not delete that roster." };
  }
}

const prospectsSchema = z
  .array(
    z.object({
      name: z.string().min(1).max(60),
      wowClass: z.string().max(30).optional(),
      spec: z.string().max(60).optional(),
      role: z.enum(["tank", "healer", "dps"]).optional(),
    }),
  )
  .max(60);

/**
 * Replace a board's trials — the people who aren't on the roster yet.
 *
 * The whole list at once, because the client holds it and add/remove is a
 * two-line edit there. These never become characters: a trial who has not
 * raided must not appear in attendance, loot priority or anything else that
 * counts the roster, and creating one to answer "would a second resto shaman
 * help" is how that happens by accident.
 */
export async function setRosterProspects(
  id: string,
  prospects: unknown,
): Promise<RosterResult> {
  const parsed = prospectsSchema.safeParse(prospects);
  if (!parsed.success) return { ok: false, message: "That doesn't look like a list of players." };
  try {
    requireCapability(await resolveViewer(), "raid.plan");
    const repo = await getWriteRepo();
    await repo.updateGuildRoster(id, { prospects: sanitizeProspects(parsed.data) });
    refreshAfterWrite("/raid-planner");
    return { ok: true, message: "Saved.", id };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not save those players." };
  }
}
