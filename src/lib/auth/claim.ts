import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  bumpDataVersion,
  countAccounts,
  insertGuildAuditEntry,
  getDb,
  insertGuildRole,
  insertMembership,
  loadStore,
  setAccountAppAdmin,
  upsertAccount,
  withTx,
} from "@/lib/data/db";
import type { DiscordIdentity } from "@/lib/auth/discord";

/**
 * Claiming a fresh deployment.
 *
 * The first person through the door becomes the guild master of the guild
 * already in the database *and* the service operator. One account: the two are
 * different powers, not different people, and the flag grants nothing inside a
 * guild anyway (see docs/guild-and-player-profiles.md §7).
 *
 * **Why a code at all, when the UI is the friendly way in?** An unclaimed
 * deployment that anyone can claim belongs to whoever finds the URL first. The
 * code is printed to the server console, so claiming requires access to the
 * machine — which the real owner has and a passer-by does not. It is the
 * cheapest possible proof and it costs the owner one glance at their terminal.
 */

const globalClaim = globalThis as unknown as { __projectlcClaimCode?: string };

/**
 * The code for this process.
 *
 * Regenerated on restart unless pinned by env, which is the right default: a
 * code that survives forever is a permanent second key to the deployment, and
 * once the app is claimed the code stops meaning anything at all.
 */
export function claimCode(): string {
  const pinned = process.env.PROJECTLC_CLAIM_CODE?.trim();
  if (pinned) return pinned;
  globalClaim.__projectlcClaimCode ??= randomBytes(6).toString("hex");
  return globalClaim.__projectlcClaimCode;
}

/**
 * True once somebody actually **owns** a guild here.
 *
 * Deliberately not "an account exists". Signing in creates an account, and an
 * account on its own owns nothing — so keying on the row count meant that one
 * ordinary sign-in before the claim closed the claim page forever, leaving a
 * deployment with no guild master, no roles, and no way to appoint either.
 * A one-click brick, reachable from the sign-in button.
 *
 * Ownership is the thing the claim actually confers, so ownership is the thing
 * to ask about.
 */
export function deploymentClaimed(): boolean {
  return db_hasAnyOwner();
}

function db_hasAnyOwner(): boolean {
  const row = getDb()
    .prepare("SELECT 1 AS x FROM memberships WHERE is_guild_master = 1 LIMIT 1")
    .get() as { x?: number } | undefined;
  return row !== undefined;
}

/** Constant-time compare, so a wrong code leaks nothing about the right one. */
export function claimCodeMatches(candidate: string): boolean {
  const expected = Buffer.from(claimCode());
  const given = Buffer.from(candidate.trim());
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

/**
 * The starting roles a guild gets.
 *
 * Suggestions the way `DEFAULT_POLICY` ships numbers: a guild is expected to
 * edit these, and nothing in the app depends on their names. The one that is
 * not a suggestion is the baseline — every member carries it, and what it
 * grants is the guild's first real policy argument. It ships able to *see* the
 * guild and the roster and nothing more, because a raider who sees too much on
 * day one is much harder to walk back than one who asks for more.
 */
const STARTER_ROLES = [
  {
    name: "Member",
    baseline: true,
    capabilities: ["guild.view", "roster.view"],
  },
  {
    name: "Raider",
    baseline: false,
    capabilities: ["logs.view", "priority.view", "loot.view"],
  },
  {
    name: "Officer",
    baseline: false,
    capabilities: [
      "roster.edit", "loot.award", "priority.edit", "logs.edit",
      "raid.plan", "import.run", "comments.write", "items.curate",
      // Administrative, and the reason succession's 30-day tier is not empty:
      // if every owner goes quiet, officers are who the guild expects to sort
      // it out. Deliberately NOT `roles.manage` — that one is guild-master-
      // equivalent by construction, since anyone holding it can grant
      // themselves anything, so it stays with owners.
      "members.manage",
    ],
  },
] as const;

export interface ClaimResult {
  accountId: string;
  displayName: string;
}

/**
 * Claim the deployment: an account, the starter roles, and a guild master.
 *
 * One transaction and one version bump. A half-claimed deployment — an account
 * with no guild master, say — has no way back through the UI, because
 * `deploymentClaimed()` would already be true and the claim page closed.
 */
export function claimDeployment(identity: DiscordIdentity & { now: string }): ClaimResult {
  const db = getDb();
  const store = loadStore(db);
  const guildId = store.guild.id;
  const displayName = identity.discordUsername ?? "Guild master";

  return withTx(db, () => {
    if (countAccounts(db) > 0) throw new Error("This deployment has already been claimed.");

    const person = upsertAccount(db, identity);
    // Operator of the service as well as master of this guild. The flag is
    // service-scoped: it opens /admin and grants nothing in any guild, here or
    // anywhere else.
    setAccountAppAdmin(db, person.id, true);

    STARTER_ROLES.forEach((role, index) => {
      insertGuildRole(db, {
        id: `role_${randomBytes(8).toString("hex")}`,
        guildId,
        name: role.name,
        sort: index,
        capabilities: [...role.capabilities],
        baseline: role.baseline,
      });
    });

    insertMembership(db, {
      id: `mem_${randomBytes(8).toString("hex")}`,
      guildId,
      accountId: person.id,
      displayName,
      // Ownership, and the reason the claim exists: somebody has to be able to
      // grant everything else. Roles are left empty — a guild master holds every
      // capability implicitly, so naming any here would only be misleading.
      isGuildMaster: true,
      roleIds: [],
      joinedAt: identity.now,
    });

    // Every other ownership change is audited; so is the first one. An audit
    // log that starts midway through the story cannot answer "who has ever
    // owned this guild", which is the question it exists for.
    insertGuildAuditEntry(db, {
      id: `aud_${randomBytes(8).toString("hex")}`,
      guildId,
      kind: "deployment.claimed",
      actor: displayName,
      detail: `${displayName} claimed this deployment and became guild owner.`,
      at: identity.now,
    });
    bumpDataVersion(db);
    return { accountId: person.id, displayName };
  });
}

/** Print the code once per process, so the owner can see it without digging. */
export function announceClaimCode(): void {
  if (deploymentClaimed()) return;
  console.log(
    `\n  projectLC is unclaimed. Claim it at /claim with this code:\n\n      ${claimCode()}\n\n  (regenerated on restart; set PROJECTLC_CLAIM_CODE to pin it)\n`,
  );
}
