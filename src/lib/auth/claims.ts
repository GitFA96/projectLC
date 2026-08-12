import { randomBytes } from "node:crypto";
import {
  bumpDataVersion,
  characterIdentity,
  getCharacterMembershipId,
  getDb,
  getMembership,
  insertGuildAuditEntry,
  setCharacterMembership,
  withTx,
} from "@/lib/data/db";

/**
 * Who plays what, set by an officer rather than by an invitation.
 *
 * Redeeming an invite is the usual way a character gets claimed, but it cannot
 * be the only one. The founder's own character is the obvious gap — claiming a
 * deployment makes somebody the owner of a guild, which is a different fact
 * from *which raider they are*, and nothing in the claim links the two. An
 * officer correcting a mis-linked character is the other.
 *
 * Both directions are audited, because a character's claim decides whose
 * wishlist and whose attendance a page is showing.
 */

export type ClaimProblem = "character-missing" | "membership-missing" | "already-claimed" | "not-claimed";

export const CLAIM_PROBLEM_TEXT: Record<ClaimProblem, string> = {
  "character-missing": "That character is not on this guild's roster.",
  "membership-missing": "That member does not belong to this guild.",
  "already-claimed": "That character is already linked to somebody. Unlink it first.",
  "not-claimed": "That character was not linked to anybody.",
};

export type ClaimResult = { ok: true } | { ok: false; reason: ClaimProblem };

/**
 * Link a roster character to a member.
 *
 * **Refuses a character somebody already holds.** Reassigning in one step is
 * the convenient version and the wrong one: it would let a mis-click move a
 * raider's whole loot history onto another person with nothing in the log
 * saying it happened. Unlinking is a separate, named act, so the audit trail
 * reads as two decisions because it was two decisions.
 */
export function linkCharacter(input: {
  guildId: string;
  characterId: string;
  membershipId: string;
  actor: string;
  now?: string;
}): ClaimResult {
  const db = getDb();
  const now = input.now ?? new Date().toISOString();

  return withTx(db, () => {
    const character = characterIdentity(db, input.characterId);
    if (character?.guildId !== input.guildId) return { ok: false, reason: "character-missing" } as const;
    const membership = getMembership(db, input.membershipId);
    if (!membership || membership.guildId !== input.guildId) {
      return { ok: false, reason: "membership-missing" } as const;
    }

    const current = getCharacterMembershipId(db, input.characterId);
    if (current && current !== input.membershipId) return { ok: false, reason: "already-claimed" } as const;
    if (current === input.membershipId) return { ok: true } as const;

    setCharacterMembership(db, input.characterId, input.membershipId);
    insertGuildAuditEntry(db, {
      id: `aud_${randomBytes(8).toString("hex")}`,
      guildId: input.guildId,
      kind: "character.linked",
      actor: input.actor,
      detail: `${input.actor} linked ${character.name} to ${membership.displayName}.`,
      at: now,
    });
    bumpDataVersion(db);
    return { ok: true } as const;
  });
}

/**
 * Hand a character back to nobody.
 *
 * The character, its awards and its history are untouched — this only says the
 * account no longer speaks for it (invariant 6). That is also what makes it
 * safe to offer: nothing is destroyed, so a wrong link is cheap to undo.
 */
export function unlinkCharacter(input: {
  guildId: string;
  characterId: string;
  actor: string;
  now?: string;
}): ClaimResult {
  const db = getDb();
  const now = input.now ?? new Date().toISOString();

  return withTx(db, () => {
    const character = characterIdentity(db, input.characterId);
    if (character?.guildId !== input.guildId) return { ok: false, reason: "character-missing" } as const;
    const current = getCharacterMembershipId(db, input.characterId);
    if (!current) return { ok: false, reason: "not-claimed" } as const;
    const previous = getMembership(db, current);

    setCharacterMembership(db, input.characterId, null);
    insertGuildAuditEntry(db, {
      id: `aud_${randomBytes(8).toString("hex")}`,
      guildId: input.guildId,
      kind: "character.unlinked",
      actor: input.actor,
      detail: `${input.actor} unlinked ${character.name} from ${previous?.displayName ?? "a former member"}.`,
      at: now,
    });
    bumpDataVersion(db);
    return { ok: true } as const;
  });
}
