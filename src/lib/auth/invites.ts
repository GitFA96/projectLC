import { randomBytes } from "node:crypto";
import {
  bumpDataVersion,
  characterIdentity,
  deleteGuildInvite,
  findInviteByCodeHash,
  findMembershipByAccount,
  getCharacterMembershipId,
  getDb,
  guildRoleIds,
  hashToken,
  insertGuildAuditEntry,
  insertGuildInvite,
  insertMembership,
  markInviteRedeemed,
  setCharacterMembership,
  setMembershipRoles,
  withTx,
} from "@/lib/data/db";
import type { GuildInvite } from "@/lib/types";

/**
 * Getting a person into a guild.
 *
 * An invite is the *only* way in after the deployment claim: there is no
 * self-registration, because membership has to match a character an officer
 * already put on the roster (docs/guild-and-player-profiles.md §3). Redeeming
 * one is a single act with three effects — an account becomes a member, a
 * character becomes theirs, and the code stops working.
 *
 * Two properties are what separate an invite from a shared password, and both
 * live here rather than in the table:
 *
 *   - **One use.** Checked again inside the transaction, not just before it, so
 *     two browsers redeeming the same code at the same moment cannot both win.
 *   - **A deadline.** A code that works forever is a credential nobody rotates.
 *
 * The database stores the SHA-256 of a code and never the code itself, so the
 * value below is the only time it exists. An officer who loses it issues
 * another; nothing can recover the first.
 */

/** Long enough to organise a raider, short enough that a leaked code dies. */
export const INVITE_TTL_DAYS = 14;

/**
 * Crockford base32: exactly 32 symbols, with `I`, `L`, `O` and `U` left out.
 *
 * Chosen because these codes get read aloud on Discord and retyped by hand.
 * Dropping the confusable glyphs means `0`/`O` and `1`/`I`/`L` cannot be
 * mistyped into a different valid code — they normalise back to the same one.
 * Exactly 32 also lets a random byte become a symbol by masking five bits,
 * which is uniform; `% alphabet.length` on a shorter alphabet would not be.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 16;
const GROUP = 4;

/** A fresh code, grouped for reading. 80 bits — unguessable, still retypable. */
export function newInviteCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[bytes[i] & 31];
  return formatInviteCode(out);
}

export function formatInviteCode(canonical: string): string {
  return (canonical.match(new RegExp(`.{1,${GROUP}}`, "g")) ?? []).join("-");
}

/**
 * The one form that gets hashed.
 *
 * Everything a person might reasonably type has to land on the same string, or
 * a valid code reads as wrong: spacing, case, the dashes we added ourselves,
 * and the Crockford substitutions. Returns null when the result could not be a
 * code we issued, which is a different answer from "no such invite".
 */
export function normalizeInviteCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const canonical = raw
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (canonical.length !== CODE_LENGTH) return null;
  for (const ch of canonical) if (!ALPHABET.includes(ch)) return null;
  return canonical;
}

/**
 * Why an invite cannot be used. Each one is shown to whoever is holding the
 * code, so none of them says anything about a guild the holder cannot see.
 */
export type InviteProblem =
  | "malformed"
  | "unknown"
  | "used"
  | "expired"
  | "character-missing"
  | "character-taken";

export const INVITE_PROBLEM_TEXT: Record<InviteProblem, string> = {
  malformed: "That does not look like an invite code.",
  unknown: "This invite code is not valid.",
  used: "This invite has already been used.",
  expired: "This invite has expired. Ask an officer for a new one.",
  "character-missing": "The character this invite was for is no longer on the roster.",
  "character-taken": "That character has already been claimed by someone else.",
};

/** A refusal that must roll back whatever the transaction had started. */
class InviteRefusal extends Error {
  constructor(readonly reason: InviteProblem) {
    super(reason);
  }
}

function refuse(reason: InviteProblem): never {
  throw new InviteRefusal(reason);
}

/** Run domain work that may refuse, turning a refusal into a result. */
function attempt<T>(fn: () => T): { ok: true; value: T } | { ok: false; reason: InviteProblem } {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    if (e instanceof InviteRefusal) return { ok: false, reason: e.reason };
    throw e;
  }
}

/* --- Looking one up ----------------------------------------------------- */

type Db = ReturnType<typeof getDb>;

/**
 * Find a live invite, or say why there isn't one.
 *
 * The expiry and single-use checks live here rather than in the SQL finder
 * deliberately: `findInviteByCodeHash` is a row reader and answers "is there a
 * row", which is a different question from "may this be used", and a caller
 * that only asked the first would let a year-old redeemed code back in.
 */
function liveInvite(db: Db, code: string, now: string): GuildInvite {
  const canonical = normalizeInviteCode(code);
  if (!canonical) refuse("malformed");

  const invite = findInviteByCodeHash(db, hashToken(canonical));
  if (!invite) refuse("unknown");
  if (invite.redeemedAt) refuse("used");
  if (Date.parse(invite.expiresAt) <= Date.parse(now)) refuse("expired");
  return invite;
}

export interface InvitePreview {
  invite: GuildInvite;
  characterId: string;
  /** Who they are being invited to play. The whole point of the preview. */
  characterName: string;
  guildId: string;
}

/**
 * Can this code be used, without using it?
 *
 * The join page asks before sending anybody to Discord, so a stale code costs
 * a sentence rather than a round trip and a confusing failure on the way back.
 */
export function checkInvite(
  code: string,
  now: string = new Date().toISOString(),
): { ok: true; preview: InvitePreview } | { ok: false; reason: InviteProblem } {
  const db = getDb();
  const result = attempt(() => {
    const invite = liveInvite(db, code, now);
    const character = characterIdentity(db, invite.characterId);
    if (character?.guildId !== invite.guildId) refuse("character-missing");
    return { invite, characterId: invite.characterId, characterName: character.name, guildId: invite.guildId };
  });
  return result.ok ? { ok: true, preview: result.value } : result;
}

/* --- Issuing ------------------------------------------------------------ */

export interface IssueInviteInput {
  guildId: string;
  /** Always a character already on the roster — that is what the invite binds. */
  characterId: string;
  /** Roles the redeemer lands with. Empty means the baseline role alone. */
  roleIds?: readonly string[];
  /** Membership id of the issuing officer, or "system" for a bootstrap invite. */
  createdBy: string;
  /** Display name of the issuer, for the audit line. */
  actor: string;
  now?: string;
  ttlDays?: number;
}

export interface IssuedInvite {
  invite: GuildInvite;
  /** Shown once. Nothing can recover it afterwards — only its hash is stored. */
  code: string;
}

/**
 * Issue an invitation for one roster character.
 *
 * **Issuing supersedes any unredeemed invite for the same character.** "Send it
 * again" is the common case — a code gets lost in a Discord DM — and leaving
 * the old one live would mean every resend adds another working key to the
 * guild that nobody remembers handing out.
 */
export function issueInvite(input: IssueInviteInput): { ok: true; issued: IssuedInvite } | { ok: false; reason: InviteProblem } {
  const db = getDb();
  const now = input.now ?? new Date().toISOString();
  const ttl = Math.max(1, Math.round(input.ttlDays ?? INVITE_TTL_DAYS));

  const result = attempt(() =>
    withTx(db, () => {
      const character = characterIdentity(db, input.characterId);
      if (character?.guildId !== input.guildId) refuse("character-missing");
      // Somebody already plays this character. They do not need an invite; they
      // need to sign in. Catching it here is far kinder than at redemption,
      // where the person holding the code cannot do anything about it.
      if (getCharacterMembershipId(db, input.characterId)) refuse("character-taken");

      for (const stale of unredeemedInvitesFor(db, input.characterId)) deleteGuildInvite(db, stale);

      // A role deleted since the officer opened the page would otherwise be
      // granted as a dangling id that nothing resolves.
      const live = guildRoleIds(db, input.guildId);
      const roleIds = [...new Set(input.roleIds ?? [])].filter((r) => live.has(r));

      const code = newInviteCode();
      const invite: GuildInvite = {
        id: `inv_${randomBytes(8).toString("hex")}`,
        guildId: input.guildId,
        characterId: input.characterId,
        codeHash: hashToken(normalizeInviteCode(code)!),
        roleIds,
        createdBy: input.createdBy,
        createdAt: now,
        expiresAt: new Date(Date.parse(now) + ttl * 24 * 60 * 60 * 1000).toISOString(),
      };
      insertGuildInvite(db, invite);

      insertGuildAuditEntry(db, {
        id: `aud_${randomBytes(8).toString("hex")}`,
        guildId: input.guildId,
        kind: "invite.issued",
        actor: input.actor,
        detail: `${input.actor} invited someone to play ${character.name}.`,
        at: now,
      });
      bumpDataVersion(db);
      return { invite, code };
    }),
  );
  return result.ok ? { ok: true, issued: result.value } : result;
}

function unredeemedInvitesFor(db: Db, characterId: string): string[] {
  const rows = db
    .prepare("SELECT id FROM guild_invites WHERE character_id = ? AND redeemed_at IS NULL")
    .all(characterId) as { id: string }[];
  return rows.map((r) => r.id);
}

/* --- Redeeming ---------------------------------------------------------- */

export interface RedeemInviteInput {
  code: string;
  /** The account that just proved itself to Discord. */
  accountId: string;
  /** Their Discord name, used only when a membership has to be created. */
  displayName: string;
  now?: string;
}

export interface RedeemedInvite {
  guildId: string;
  membershipId: string;
  characterId: string;
  /** False when this account was already a member and only claimed a character. */
  joined: boolean;
}

/**
 * Use an invite: become a member, and take the character it names.
 *
 * **An account that is already a member of this guild reuses that membership.**
 * The alt case is the ordinary one — a raider with a main and two alts is one
 * person, one membership, three claimed characters — and inserting a second
 * membership would split their loot history in half. The schema now refuses it
 * outright; before it did, it orphaned character claims silently and only
 * surfaced as a failure to boot.
 *
 * Roles on an existing membership are **added to, never replaced.** An invite
 * carries the roles an officer chose for it, so widening is a decision somebody
 * made; narrowing would let a routine "here's your alt" invite quietly demote
 * an officer, which is the kind of thing nobody notices until it matters.
 *
 * Everything happens inside one transaction, and every refusal throws, so there
 * is no path that half-joins somebody.
 */
export function redeemInvite(
  input: RedeemInviteInput,
): { ok: true; redeemed: RedeemedInvite } | { ok: false; reason: InviteProblem } {
  const db = getDb();
  const now = input.now ?? new Date().toISOString();

  const result = attempt(() =>
    withTx(db, () => {
      // Re-read inside the transaction. The join page checked this already, but
      // that check is stale the moment it returns: two tabs on one code, or a
      // revoke landing in between, both end here.
      const invite = liveInvite(db, input.code, now);
      const character = characterIdentity(db, invite.characterId);
      if (character?.guildId !== invite.guildId) refuse("character-missing");

      const existing = findMembershipByAccount(db, invite.guildId, input.accountId);
      const claimedBy = getCharacterMembershipId(db, invite.characterId);
      // Never take a character off somebody. A wrong claim misattributes years
      // of wishlists and awards, and the invite is recoverable where that is not.
      if (claimedBy && claimedBy !== existing?.id) refuse("character-taken");

      const live = guildRoleIds(db, invite.guildId);
      const granted = invite.roleIds.filter((r) => live.has(r));

      let membershipId: string;
      let joined: boolean;
      if (existing) {
        membershipId = existing.id;
        joined = false;
        const merged = [...new Set([...existing.roleIds, ...granted])];
        if (merged.length !== existing.roleIds.length) setMembershipRoles(db, existing.id, merged);
      } else {
        membershipId = `mem_${randomBytes(8).toString("hex")}`;
        joined = true;
        insertMembership(db, {
          id: membershipId,
          guildId: invite.guildId,
          accountId: input.accountId,
          displayName: input.displayName,
          // Ownership is never granted by an invite. It moves by transfer or by
          // succession, both of which are audited acts of an existing owner.
          isGuildMaster: false,
          roleIds: granted,
          joinedAt: now,
        });
      }

      setCharacterMembership(db, invite.characterId, membershipId);
      markInviteRedeemed(db, invite.id, membershipId, now);

      insertGuildAuditEntry(db, {
        id: `aud_${randomBytes(8).toString("hex")}`,
        guildId: invite.guildId,
        kind: joined ? "invite.joined" : "invite.linked",
        actor: input.displayName,
        detail: joined
          ? `${input.displayName} joined the guild and claimed ${character.name}.`
          : `${input.displayName} claimed ${character.name} on an existing membership.`,
        at: now,
      });
      bumpDataVersion(db);
      return { guildId: invite.guildId, membershipId, characterId: invite.characterId, joined };
    }),
  );
  return result.ok ? { ok: true, redeemed: result.value } : result;
}

/* --- Withdrawing -------------------------------------------------------- */

/**
 * Take an unredeemed invite back.
 *
 * A redeemed one is not revocable — the person is a member, and removing them
 * is `deleteMembership`'s job. Deleting the row would only erase the record of
 * how they got in.
 */
export function revokeInvite(input: {
  inviteId: string;
  guildId: string;
  actor: string;
  now?: string;
}): boolean {
  const db = getDb();
  const now = input.now ?? new Date().toISOString();
  return withTx(db, () => {
    const row = db
      .prepare("SELECT redeemed_at FROM guild_invites WHERE id = ? AND guild_id = ?")
      .get(input.inviteId, input.guildId) as { redeemed_at: string | null } | undefined;
    if (!row || row.redeemed_at) return false;

    deleteGuildInvite(db, input.inviteId);
    insertGuildAuditEntry(db, {
      id: `aud_${randomBytes(8).toString("hex")}`,
      guildId: input.guildId,
      kind: "invite.revoked",
      actor: input.actor,
      detail: `${input.actor} revoked an unused invitation.`,
      at: now,
    });
    bumpDataVersion(db);
    return true;
  });
}
