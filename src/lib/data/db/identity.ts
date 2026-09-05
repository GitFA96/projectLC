import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
  accountSchema,
  authSessionSchema,
  guildInviteSchema,
  membershipSchema,
} from "@/lib/import/schemas";
import type { AccountRow } from "@/lib/types";
import type {
  Account,
  AuthSession,
  GuildAuditEntry,
  GuildInvite,
  GuildRole,
  Membership,
} from "@/lib/types";
import { bumpDataVersion, type Row, withTx } from "@/lib/data/db/core";
import {
  rowToAccount,
  rowToAuthSession,
  rowToGuildInvite,
  rowToMembership,
} from "@/lib/data/db/rows";
/**
 * Accounts, sessions, memberships, roles and invitations.
 *
 * Split from the guild's own data on purpose. An account is a person and a
 * membership is that person in this guild, so signing in must not bump
 * `data_version` — a login is not a change to what the read model serves.
 * Ownership changes are the exception, and each writes an audit entry.
 */

/** SHA-256, hex. Used for session cookies and invite codes — never the value itself. */
export function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function countAccounts(db: DatabaseSync): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number };
  return Number(row.n);
}

export function getAccount(db: DatabaseSync, id: string): Account | undefined {
  const row = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id) as Row | undefined;
  return row ? accountSchema.parse(rowToAccount(row)) : undefined;
}

/** The account for a Discord identity. One per identity. */
export function findAccountByDiscordId(db: DatabaseSync, discordId: string): Account | undefined {
  const row = db.prepare("SELECT * FROM accounts WHERE discord_id = ?").get(discordId) as Row | undefined;
  return row ? accountSchema.parse(rowToAccount(row)) : undefined;
}

/**
 * Record that this account was actually used.
 *
 * Signing in is not activity. A session lasts 30 days, so somebody who signs in
 * once and then uses the app daily would show `last_seen_at` from a month ago —
 * and every succession window is measured against that column. Without this the
 * inactivity rules fire on a guild's most active officers.
 *
 * Throttled by its caller (see `currentAccount`), because the alternative is a
 * write on every request. No version bump: accounts are outside the read model.
 */
export function touchAccountSeen(db: DatabaseSync, id: string, now: string): void {
  db.prepare("UPDATE accounts SET last_seen_at = ? WHERE id = ?").run(now, id);
}

/** When this membership's account was last seen. Null when it never has been. */
export function membershipLastSeen(db: DatabaseSync, membershipId: string): string | null {
  const row = db
    .prepare(
      `SELECT a.last_seen_at AS seen FROM memberships m
       JOIN accounts a ON a.id = m.account_id WHERE m.id = ?`,
    )
    .get(membershipId) as Row | undefined;
  return (row?.seen as string | null) ?? null;
}

/**
 * Last-seen for every membership in a guild, in one query.
 *
 * Lives here rather than in the read model because `accounts` is deliberately
 * outside it: a login writes `last_seen_at`, and if that bumped `data_version`
 * every sign-in would rebuild the whole in-memory store. Callers pay one small
 * query instead, and get a live answer rather than one frozen at rebuild time.
 */
export function membershipLastSeenByGuild(db: DatabaseSync, guildId: string): Record<string, string | null> {
  const rows = db
    .prepare(
      `SELECT m.id AS membership_id, a.last_seen_at AS seen FROM memberships m
       JOIN accounts a ON a.id = m.account_id WHERE m.guild_id = ?`,
    )
    .all(guildId) as Row[];
  return Object.fromEntries(rows.map((r) => [r.membership_id as string, (r.seen as string | null) ?? null]));
}

export interface DiscordIdentity {
  discordId: string;
  discordUsername?: string;
  avatarUrl?: string;
  now: string;
}

/**
 * The login write: create on first sight, refresh the display fields on every
 * sight.
 *
 * Discord names and avatars change and the stored copy is display-only — the
 * `discord_id` is the identity. **`app_admin` is never read or written here.**
 * Signing in is not a place where privilege changes, in either direction.
 */
export function upsertAccount(db: DatabaseSync, identity: DiscordIdentity): Account {
  const existing = findAccountByDiscordId(db, identity.discordId);
  if (existing) {
    db.prepare(
      "UPDATE accounts SET discord_username = ?, avatar_url = ?, last_seen_at = ? WHERE id = ?",
    ).run(identity.discordUsername ?? null, identity.avatarUrl ?? null, identity.now, existing.id);
    return {
      ...existing,
      discordUsername: identity.discordUsername,
      avatarUrl: identity.avatarUrl,
      lastSeenAt: identity.now,
    };
  }
  const account: Account = {
    id: `acc_${randomUUID()}`,
    discordId: identity.discordId,
    discordUsername: identity.discordUsername,
    avatarUrl: identity.avatarUrl,
    appAdmin: false,
    disabled: false,
    createdAt: identity.now,
    lastSeenAt: identity.now,
  };
  db.prepare(
    `INSERT INTO accounts (id, discord_id, discord_username, avatar_url, app_admin, disabled, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, 0, 0, ?, ?)`,
  ).run(
    account.id, account.discordId, account.discordUsername ?? null, account.avatarUrl ?? null,
    account.createdAt, account.lastSeenAt ?? null,
  );
  return account;
}

/**
 * Promote or demote a service operator.
 *
 * Says nothing about any guild. An operator who is also somebody's guild master
 * gets that power from their membership, not from this flag — the flag grants
 * nothing inside a guild at all. See decide() in src/lib/auth/can.ts.
 */
export function setAccountAppAdmin(db: DatabaseSync, id: string, appAdmin: boolean): void {
  db.prepare("UPDATE accounts SET app_admin = ? WHERE id = ?").run(appAdmin ? 1 : 0, id);
}

/**
 * How many people can still administer this deployment.
 *
 * The same shape as `guildOwnerIds` and for the same reason: dropping to zero
 * is the one state the service can enter and never leave. Nobody could reach
 * `/service` to grant the flag back, because reaching `/service` requires it —
 * and unlike a guild, there is no succession ladder underneath.
 */
export function countAppAdmins(db: DatabaseSync): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE app_admin = 1 AND disabled = 0").get() as { n: number };
  return Number(row.n);
}

export interface OpenBreakGlass {
  id: string;
  guildId: string;
  accountId: string;
  reason: string;
  openedAt: string;
  expiresAt: string;
}

/**
 * Open an override into a guild the operator is not a member of.
 *
 * Short by default and bounded hard. A break-glass that lasted a week would be
 * an operator account with permanent guild access wearing a scarier name, and
 * the whole point is that it is temporary, reasoned and visible.
 */
export const BREAK_GLASS_MAX_MINUTES = 120;

export function openBreakGlass(
  db: DatabaseSync,
  input: { guildId: string; accountId: string; reason: string; minutes: number; now?: string },
): OpenBreakGlass {
  const now = input.now ?? new Date().toISOString();
  const minutes = Math.min(BREAK_GLASS_MAX_MINUTES, Math.max(1, Math.round(input.minutes)));
  const row: OpenBreakGlass = {
    id: `bg_${randomUUID().slice(0, 12)}`,
    guildId: input.guildId,
    accountId: input.accountId,
    reason: input.reason.trim().slice(0, 300),
    openedAt: now,
    expiresAt: new Date(Date.parse(now) + minutes * 60_000).toISOString(),
  };
  db.prepare(
    `INSERT INTO break_glass (id, guild_id, account_id, reason, opened_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.guildId, row.accountId, row.reason, row.openedAt, row.expiresAt);
  return row;
}

/**
 * The operator's open, unexpired override for a guild, if there is one.
 *
 * Expiry is checked in the query rather than by a sweeper, so a forgotten
 * break-glass simply stops working — there is no state where somebody has to
 * remember to close it for the guild to be safe again.
 */
export function findOpenBreakGlass(
  db: DatabaseSync,
  accountId: string,
  guildId: string,
  now: string = new Date().toISOString(),
): OpenBreakGlass | undefined {
  const r = db
    .prepare(
      `SELECT * FROM break_glass
        WHERE account_id = ? AND guild_id = ? AND closed_at IS NULL AND expires_at > ?
        ORDER BY opened_at DESC LIMIT 1`,
    )
    .get(accountId, guildId, now) as Row | undefined;
  return r
    ? {
        id: r.id as string,
        guildId: r.guild_id as string,
        accountId: r.account_id as string,
        reason: r.reason as string,
        openedAt: r.opened_at as string,
        expiresAt: r.expires_at as string,
      }
    : undefined;
}

/** Close one early. Expiry already handles the forgotten case. */
export function closeBreakGlass(db: DatabaseSync, id: string, at: string = new Date().toISOString()): boolean {
  return Number(db.prepare("UPDATE break_glass SET closed_at = ? WHERE id = ? AND closed_at IS NULL").run(at, id).changes) > 0;
}

/** Every account on this deployment, newest first. Service-level: no guild data. */
export function listAccounts(db: DatabaseSync): AccountRow[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.discord_username, a.app_admin, a.disabled, a.created_at, a.last_seen_at,
              (SELECT COUNT(*) FROM auth_sessions s
                WHERE s.account_id = a.id AND s.revoked_at IS NULL AND s.expires_at > ?) AS live_sessions,
              (SELECT COUNT(*) FROM memberships m WHERE m.account_id = a.id) AS guild_count
         FROM accounts a ORDER BY a.created_at DESC`,
    )
    .all(new Date().toISOString()) as Row[];
  return rows.map((r) => ({
    id: r.id as string,
    discordUsername: (r.discord_username as string | null) ?? null,
    appAdmin: r.app_admin === 1,
    disabled: r.disabled === 1,
    createdAt: r.created_at as string,
    lastSeenAt: (r.last_seen_at as string | null) ?? null,
    liveSessions: Number(r.live_sessions),
    guildCount: Number(r.guild_count),
  }));
}

export function setAccountDisabled(db: DatabaseSync, id: string, disabled: boolean): void {
  db.prepare("UPDATE accounts SET disabled = ? WHERE id = ?").run(disabled ? 1 : 0, id);
  // A disabled account keeps no live sessions, or disabling does nothing until
  // the cookie happens to expire.
  if (disabled) revokeAccountSessions(db, id);
}

export function createAuthSession(
  db: DatabaseSync,
  input: { tokenHash: string; accountId: string; createdAt: string; expiresAt: string; userAgent?: string },
): void {
  db.prepare(
    `INSERT INTO auth_sessions (id, account_id, created_at, expires_at, user_agent)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(input.tokenHash, input.accountId, input.createdAt, input.expiresAt, input.userAgent ?? null);
}

export function findAuthSession(db: DatabaseSync, tokenHash: string): AuthSession | undefined {
  const row = db.prepare("SELECT * FROM auth_sessions WHERE id = ?").get(tokenHash) as Row | undefined;
  return row ? authSessionSchema.parse(rowToAuthSession(row)) : undefined;
}

export function revokeAuthSession(db: DatabaseSync, tokenHash: string, at: string): void {
  // Kept rather than deleted: a row that is gone is indistinguishable from one
  // that never existed, and "this cookie was signed out" is worth being able to say.
  db.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(at, tokenHash);
}

export function revokeAccountSessions(db: DatabaseSync, accountId: string): number {
  const at = new Date().toISOString();
  return Number(
    db.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL").run(at, accountId).changes,
  );
}

/** Housekeeping: expired rows can never authenticate anything again. */
export function purgeExpiredAuthSessions(db: DatabaseSync, before: string): number {
  return Number(db.prepare("DELETE FROM auth_sessions WHERE expires_at < ?").run(before).changes);
}

/* --- Guild-data identity. These bump, because the read model serves them. --- */

export function insertGuildRole(db: DatabaseSync, role: GuildRole): void {
  db.prepare(
    `INSERT OR REPLACE INTO guild_roles (id, guild_id, name, colour, sort, capabilities_json, baseline)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(role.id, role.guildId, role.name, role.colour ?? null, role.sort, JSON.stringify(role.capabilities), role.baseline ? 1 : 0);
}

/**
 * Remove a role, and take it off everyone who held it.
 *
 * The second half is the part that fails silently if skipped: a membership
 * holding a deleted role id trips validateStore on the next read model rebuild,
 * which happens on some unrelated write minutes later and reads as a corrupt
 * database. The baseline role is undeletable — it is what every membership
 * falls back to.
 */
export function deleteGuildRole(db: DatabaseSync, id: string): { ok: boolean; error?: string } {
  const row = db.prepare("SELECT baseline FROM guild_roles WHERE id = ?").get(id) as Row | undefined;
  if (!row) return { ok: false, error: "That role no longer exists." };
  if (row.baseline === 1) return { ok: false, error: "The baseline role can't be deleted — edit what it grants instead." };
  for (const m of db.prepare("SELECT id, role_ids_json FROM memberships").all() as Row[]) {
    const ids = JSON.parse((m.role_ids_json as string | null) ?? "[]") as string[];
    if (!ids.includes(id)) continue;
    db.prepare("UPDATE memberships SET role_ids_json = ? WHERE id = ?").run(
      JSON.stringify(ids.filter((r) => r !== id)),
      m.id as string,
    );
  }
  db.prepare("DELETE FROM guild_roles WHERE id = ?").run(id);
  return { ok: true };
}

/**
 * Add a membership.
 *
 * A plain INSERT, **not** INSERT OR REPLACE, and that is the whole point. With
 * OR REPLACE, adding a second membership for an account that already has one
 * silently deletes the first — `memberships_one_per_guild` makes them conflict.
 * The characters that pointed at the deleted row keep pointing at it, and the
 * next read model rebuild throws `claimed by unknown membershipId`, which is a
 * hard boot failure on an unrelated write minutes later.
 *
 * So a duplicate is a loud constraint error instead. Callers that mean "this
 * person may already be a member" ask `findMembershipByAccount` first — which
 * is the honest shape for invite redemption anyway: rejoining should restore
 * the membership somebody already has, not mint a second one.
 */
export function insertMembership(db: DatabaseSync, m: Membership): void {
  db.prepare(
    `INSERT INTO memberships (id, guild_id, account_id, display_name, is_guild_master, role_ids_json, joined_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(m.id, m.guildId, m.accountId, m.displayName, m.isGuildMaster ? 1 : 0, JSON.stringify(m.roleIds), m.joinedAt);
}

export function getMembership(db: DatabaseSync, id: string): Membership | undefined {
  const row = db.prepare("SELECT * FROM memberships WHERE id = ?").get(id) as Row | undefined;
  return row ? membershipSchema.parse(rowToMembership(row)) : undefined;
}

export function findMembershipByAccount(
  db: DatabaseSync,
  guildId: string,
  accountId: string,
): Membership | undefined {
  const row = db
    .prepare("SELECT * FROM memberships WHERE guild_id = ? AND account_id = ?")
    .get(guildId, accountId) as Row | undefined;
  return row ? membershipSchema.parse(rowToMembership(row)) : undefined;
}

/**
 * Everyone who owns this guild. Usually one; never, after the first, zero.
 *
 * Ownership is plural because a single owner is a single point of failure the
 * guild cannot repair: no role grants ownership, so when the only owner goes
 * quiet nobody inside can appoint a replacement. Two or three co-owners turn
 * that from an emergency into a non-event.
 */
export function guildOwnerIds(db: DatabaseSync, guildId: string): string[] {
  return (
    db
      .prepare("SELECT id FROM memberships WHERE guild_id = ? AND is_guild_master = 1 ORDER BY joined_at")
      .all(guildId) as Row[]
  ).map((r) => r.id as string);
}

export function setMembershipRoles(db: DatabaseSync, id: string, roleIds: string[]): boolean {
  return (
    Number(
      db.prepare("UPDATE memberships SET role_ids_json = ? WHERE id = ?").run(JSON.stringify(roleIds), id).changes,
    ) > 0
  );
}

/**
 * Who is changing ownership, for the audit entry every such change writes.
 *
 * `membershipId` absent means the app admin is acting. That is a legitimate
 * operator job — appointing an owner is administering the tenancy, not reading
 * the guild's loot decisions — and the guild sees it either way.
 */
export interface OwnershipActor {
  membershipId?: string;
  name: string;
  reason?: string;
}

export type OwnershipResult = { ok: true } | { ok: false; error: string };

function auditOwnership(
  db: DatabaseSync,
  guildId: string,
  kind: string,
  actor: OwnershipActor,
  detail: string,
): void {
  insertGuildAuditEntry(db, {
    id: `aud_${randomUUID()}`,
    guildId,
    kind,
    actor: actor.name,
    reason: actor.reason,
    detail,
    at: new Date().toISOString(),
  });
}

/** Make a member a co-owner. Idempotent, and always audited. */
export function addGuildOwner(
  db: DatabaseSync,
  guildId: string,
  membershipId: string,
  actor: OwnershipActor,
): OwnershipResult {
  const target = db
    .prepare("SELECT guild_id, display_name, is_guild_master FROM memberships WHERE id = ?")
    .get(membershipId) as Row | undefined;
  if (!target) return { ok: false, error: "That member no longer exists." };
  if (target.guild_id !== guildId) return { ok: false, error: "That member belongs to a different guild." };
  if (target.is_guild_master === 1) return { ok: true };

  return withTx(db, () => {
    db.prepare("UPDATE memberships SET is_guild_master = 1 WHERE id = ?").run(membershipId);
    auditOwnership(db, guildId, "owner.added", actor, `${target.display_name as string} is now a guild owner.`);
    bumpDataVersion(db);
    return { ok: true as const };
  });
}

/**
 * Take ownership away.
 *
 * Three rules, and the reasons matter more than the code:
 *
 *   - **Never the last owner.** A guild with no owner cannot appoint one, so
 *     this is the single state it can enter and never leave.
 *   - **Stepping down is always allowed** (if you are not the last). Nobody is
 *     trapped owning a guild.
 *   - **One owner may only remove another if that other has gone quiet.**
 *     Otherwise co-ownership is a race to remove the other person first. Two
 *     active owners who disagree simply cannot remove each other — that is a
 *     guild's argument to have, not the app's to settle.
 *
 * The app admin (no `membershipId`) is exempt from the third rule, because
 * arbitrating exactly that stalemate is what an operator is for.
 */
export function removeGuildOwner(
  db: DatabaseSync,
  guildId: string,
  membershipId: string,
  actor: OwnershipActor,
  opts: { inactiveDays: number; now?: Date } = { inactiveDays: 30 },
): OwnershipResult {
  const owners = guildOwnerIds(db, guildId);
  if (!owners.includes(membershipId)) return { ok: false, error: "That member is not a guild owner." };
  if (owners.length <= 1) {
    return { ok: false, error: "A guild can't be left without an owner — add another one first." };
  }

  const selfService = actor.membershipId === membershipId;
  const byAnotherOwner = actor.membershipId !== undefined && !selfService;
  if (byAnotherOwner) {
    const seen = membershipLastSeen(db, membershipId);
    const now = (opts.now ?? new Date()).getTime();
    const quietMs = opts.inactiveDays * 24 * 60 * 60 * 1000;
    const parsed = seen ? Date.parse(seen) : Number.NaN;
    // Never seen counts as quiet: an owner who has not once signed in cannot be
    // the reason a guild stays stuck.
    const quiet = !Number.isFinite(parsed) || now - parsed >= quietMs;
    if (!quiet) {
      return {
        ok: false,
        error: `That owner is still active. An owner can only be removed after ${opts.inactiveDays} days of inactivity.`,
      };
    }
  }

  const label = db.prepare("SELECT display_name FROM memberships WHERE id = ?").get(membershipId) as Row;
  return withTx(db, () => {
    db.prepare("UPDATE memberships SET is_guild_master = 0 WHERE id = ?").run(membershipId);
    auditOwnership(
      db,
      guildId,
      selfService ? "owner.stepped-down" : "owner.removed",
      actor,
      `${label.display_name as string} is no longer a guild owner.`,
    );
    bumpDataVersion(db);
    return { ok: true as const };
  });
}

export function deleteMembership(
  db: DatabaseSync,
  id: string,
): { ok: true; unlinkedCharacters: number } | { ok: false; error: string } {
  // An owner is never removed as a side effect of removing a member. Ownership
  // has its own rules — the last one cannot go, and one owner cannot push
  // another out while they are still active — and none of them can be enforced
  // from here. Demote first, deliberately, then delete.
  const row = db.prepare("SELECT is_guild_master FROM memberships WHERE id = ?").get(id) as Row | undefined;
  if (!row) return { ok: false, error: "That member no longer exists." };
  if (row.is_guild_master === 1) {
    return { ok: false, error: "That member owns the guild. Remove their ownership first." };
  }

  return withTx(db, () => {
    const unlinked = Number(
      db.prepare("UPDATE characters SET membership_id = NULL WHERE membership_id = ?").run(id).changes,
    );
    db.prepare("DELETE FROM memberships WHERE id = ?").run(id);
    bumpDataVersion(db);
    return { ok: true as const, unlinkedCharacters: unlinked };
  });
}

/**
 * The claim on a character, read straight from the row.
 *
 * Deliberately not taken off the read model: `updateCharacter` has to carry
 * this value across an INSERT OR REPLACE, and a read model that has not caught
 * up yet would hand it a null and silently unclaim the character. Ownership is
 * a permission-relevant fact, so it comes from the source of truth.
 */
export function getCharacterMembershipId(db: DatabaseSync, characterId: string): string | null {
  const row = db.prepare("SELECT membership_id FROM characters WHERE id = ?").get(characterId) as Row | undefined;
  return (row?.membership_id as string | null) ?? null;
}

/** Claim a character for a membership, or hand it back with null. */
export function setCharacterMembership(db: DatabaseSync, characterId: string, membershipId: string | null): boolean {
  return (
    Number(db.prepare("UPDATE characters SET membership_id = ? WHERE id = ?").run(membershipId, characterId).changes) > 0
  );
}

/**
 * Store an invite. **Plain INSERT, never INSERT OR REPLACE.**
 *
 * `code_hash` is UNIQUE, and OR REPLACE resolves a unique conflict by *deleting
 * the conflicting row* — so a code collision would silently destroy somebody
 * else's live invite instead of failing. The same pattern on `memberships`
 * orphaned character claims and took a boot failure to find. A collision here
 * is vanishingly unlikely; it must still be loud rather than destructive.
 */
export function insertGuildInvite(db: DatabaseSync, invite: GuildInvite): void {
  db.prepare(
    `INSERT INTO guild_invites (id, guild_id, character_id, code_hash, role_ids_json, created_by, created_at, expires_at, redeemed_at, redeemed_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    invite.id, invite.guildId, invite.characterId, invite.codeHash, JSON.stringify(invite.roleIds),
    invite.createdBy, invite.createdAt, invite.expiresAt, invite.redeemedAt ?? null, invite.redeemedBy ?? null,
  );
}

export function findInviteByCodeHash(db: DatabaseSync, codeHash: string): GuildInvite | undefined {
  const row = db.prepare("SELECT * FROM guild_invites WHERE code_hash = ?").get(codeHash) as Row | undefined;
  return row ? guildInviteSchema.parse(rowToGuildInvite(row)) : undefined;
}

export function markInviteRedeemed(db: DatabaseSync, id: string, membershipId: string, at: string): void {
  db.prepare("UPDATE guild_invites SET redeemed_at = ?, redeemed_by = ? WHERE id = ?").run(at, membershipId, id);
}

export function deleteGuildInvite(db: DatabaseSync, id: string): boolean {
  return Number(db.prepare("DELETE FROM guild_invites WHERE id = ?").run(id).changes) > 0;
}

/**
 * Housekeeping: drop invitations that expired without ever being used.
 *
 * Redeemed rows are kept deliberately. They record who let whom into the guild,
 * which is exactly the kind of thing an officer has to be able to answer later
 * (invariant 6), and they cost nothing.
 */
export function purgeExpiredInvites(db: DatabaseSync, before: string): number {
  return Number(
    db.prepare("DELETE FROM guild_invites WHERE redeemed_at IS NULL AND expires_at < ?").run(before).changes,
  );
}

/**
 * Who a character is, for the code that decides access to them.
 *
 * Read from the row rather than the read model for the same reason
 * `getCharacterMembershipId` is: it decides whether an invite may be redeemed,
 * and a stale answer would either refuse a valid invite or accept one across a
 * guild boundary. The name rides along because every one of those decisions
 * gets written to the audit log, which is read by people — an entry naming
 * `chr_f31b8934…` records that something happened and not what.
 */
export function characterIdentity(
  db: DatabaseSync,
  characterId: string,
): { guildId: string; name: string } | null {
  const row = db.prepare("SELECT guild_id, name FROM characters WHERE id = ?").get(characterId) as Row | undefined;
  return row ? { guildId: row.guild_id as string, name: row.name as string } : null;
}

/** The roles a guild actually has right now. Roles are deletable; grants naming them are not. */
export function guildRoleIds(db: DatabaseSync, guildId: string): Set<string> {
  const rows = db.prepare("SELECT id FROM guild_roles WHERE guild_id = ?").all(guildId) as Row[];
  return new Set(rows.map((r) => r.id as string));
}

/**
 * Write something the guild is entitled to know about.
 *
 * Append-only by design: nothing here updates or deletes a row, because an
 * audit log an admin can edit is not an audit log.
 */
export function insertGuildAuditEntry(db: DatabaseSync, entry: GuildAuditEntry): void {
  db.prepare(
    `INSERT INTO guild_audit (id, guild_id, kind, actor, reason, detail, at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(entry.id, entry.guildId, entry.kind, entry.actor, entry.reason ?? null, entry.detail ?? null, entry.at, entry.expiresAt ?? null);
}
