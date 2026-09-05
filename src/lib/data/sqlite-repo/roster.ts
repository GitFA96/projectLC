import { randomUUID } from "node:crypto";
import {
  bumpDataVersion,
  getDb,
  insertAttendanceExemption,
  insertCharacter,
  getCharacterMembershipId,
  insertCharacterComment,
  withTx,
} from "@/lib/data/db";
import { characterCommentSchema, characterSchema } from "@/lib/import/schemas";
import type {
  AddCommentResult,
  CharacterCommentDraft,
  CharacterDraft,
  CharacterWriteResult,
  DeleteCharacterResult,
  WriteRepo,
} from "@/lib/data/repo";
import type { Character, CharacterComment } from "@/lib/types";
import { readModel, characterByName, nameTaken } from "./model";
import type { Writes } from "./model";

/**
 * The roster itself — characters, their comments, and attendance exemptions.
 *
 * `deleteCharacter` is the one to read before changing anything here. History
 * is unlinked, never destroyed (root AGENTS.md invariant 6): the awards a
 * deleted character won reopen under the raw name they were won with, and a
 * note they left on an item stops naming them and stays readable. A past loot
 * decision has to remain explainable after the raider leaves.
 */

export const rosterWrites = {
  async findCharacterByName(name) {
    return characterByName(name);
  },

  async createCharacter(draft: CharacterDraft): Promise<CharacterWriteResult> {
    if (nameTaken(draft.name)) {
      return { ok: false, error: `A character named “${draft.name.trim()}” already exists.` };
    }
    const db = getDb();
    const guild = readModel().store.guild;
    const parsed = characterSchema.safeParse({
      ...draft,
      mainCharacterId: draft.mainCharacterId ?? null,
      professions: draft.professions ?? [],
      id: `chr_${randomUUID()}`,
      guildId: guild.id,
      // A character is created unclaimed. An account claims one by redeeming an
      // invite, or an officer links it — never as a side effect of adding it.
      membershipId: null,
    } satisfies Character);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid character." };
    withTx(db, () => {
      insertCharacter(db, parsed.data);
      bumpDataVersion(db);
    });
    return { ok: true, character: parsed.data };
  },

  async updateCharacter(id: string, draft: CharacterDraft): Promise<CharacterWriteResult> {
    const current = readModel().store.roster.find((c) => c.id === id);
    if (!current) return { ok: false, error: "Character not found." };
    if (nameTaken(draft.name, id)) {
      return { ok: false, error: `A character named “${draft.name.trim()}” already exists.` };
    }
    const parsed = characterSchema.safeParse({
      ...draft,
      mainCharacterId: draft.mainCharacterId ?? null,
      professions: draft.professions ?? [],
      id,
      guildId: current.guildId,
      // Carried across, never read off the draft. insertCharacter is INSERT OR
      // REPLACE over a fixed column list, so a claim omitted here is a claim
      // deleted — silently, on every spec change an officer makes. Claiming is
      // members.manage and has its own writer; this is roster.edit.
      //
      // Read from the row rather than from `current`, which comes off the read
      // model: if that model has not caught up with a claim made moments ago,
      // preserving it from there preserves a null.
      membershipId: getCharacterMembershipId(getDb(), id),
    } satisfies Character);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid character." };
    const db = getDb();
    withTx(db, () => {
      insertCharacter(db, parsed.data); // INSERT OR REPLACE keyed on id
      bumpDataVersion(db);
    });
    return { ok: true, character: parsed.data };
  },

  async deleteCharacter(id: string): Promise<DeleteCharacterResult> {
    const character = readModel().store.roster.find((c) => c.id === id);
    if (!character) return { ok: false, error: "Character not found." };
    const db = getDb();
    const result = { ok: true as const, unlinkedAwards: 0, unlinkedLogRows: 0, deletedGearSets: 0 };
    withTx(db, () => {
      result.unlinkedAwards = Number(
        db.prepare("UPDATE loot_awards SET character_id = NULL, external = 0 WHERE character_id = ?").run(id).changes,
      );
      result.unlinkedLogRows = Number(
        db.prepare("UPDATE wcl_player_fights SET character_id = NULL WHERE character_id = ?").run(id).changes,
      );
      db.prepare("UPDATE wcl_player_offpull SET character_id = NULL WHERE character_id = ?").run(id);
      result.deletedGearSets = Number(
        db.prepare("DELETE FROM gear_sets WHERE character_id = ?").run(id).changes,
      );
      // A note on an item is part of why a loot decision was made, so it is
      // unlinked rather than destroyed — invariant 6. It stops naming somebody
      // and stays readable.
      db.prepare("UPDATE item_comments SET character_id = NULL WHERE character_id = ?").run(id);
      // Comments, exemptions and pinned slots reference the character — they go with it.
      db.prepare("DELETE FROM character_comments WHERE character_id = ?").run(id);
      db.prepare("DELETE FROM attendance_exemptions WHERE character_id = ?").run(id);
      db.prepare("DELETE FROM current_gear_overrides WHERE character_id = ?").run(id);
      db.prepare("DELETE FROM characters WHERE id = ?").run(id);
      bumpDataVersion(db);
    });
    return result;
  },

  async setAttendanceExemption(characterId: string, weekStart: string, excused: boolean, note?: string) {
    if (!readModel().store.roster.some((c) => c.id === characterId)) {
      return { ok: false as const, error: "Character not found." };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      return { ok: false as const, error: "Invalid reset-week date." };
    }
    const db = getDb();
    withTx(db, () => {
      if (excused) {
        insertAttendanceExemption(db, { characterId, weekStart, note: note?.trim() || undefined });
      } else {
        db.prepare("DELETE FROM attendance_exemptions WHERE character_id = ? AND week_start = ?").run(
          characterId,
          weekStart,
        );
      }
      bumpDataVersion(db);
    });
    return { ok: true as const };
  },

  async addCharacterComment(draft: CharacterCommentDraft): Promise<AddCommentResult> {
    if (!readModel().store.roster.some((c) => c.id === draft.characterId)) {
      return { ok: false, error: "Character not found." };
    }
    const parsed = characterCommentSchema.safeParse({
      ...draft,
      id: `cm_${randomUUID()}`,
      createdAt: new Date().toISOString(),
    } satisfies CharacterComment);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid comment." };
    }
    const db = getDb();
    withTx(db, () => {
      insertCharacterComment(db, parsed.data);
      bumpDataVersion(db);
    });
    return { ok: true, comment: parsed.data };
  },

  async deleteCharacterComment(id: string): Promise<boolean> {
    const db = getDb();
    let deleted = false;
    withTx(db, () => {
      deleted = Number(db.prepare("DELETE FROM character_comments WHERE id = ?").run(id).changes) > 0;
      if (deleted) bumpDataVersion(db);
    });
    return deleted;
  },
} satisfies Partial<Writes> & ThisType<WriteRepo>;
