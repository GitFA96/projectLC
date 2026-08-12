import { randomBytes } from "node:crypto";
import {
  baselineViolations,
  CAPABILITIES,
  sanitizeCapabilities,
  type Capability,
} from "@/lib/auth/capabilities";
import {
  bumpDataVersion,
  deleteGuildRole,
  getDb,
  getMembership,
  insertGuildAuditEntry,
  insertGuildRole,
  loadStore,
  setMembershipRoles,
  withTx,
} from "@/lib/data/db";
import type { GuildRole } from "@/lib/types";

/**
 * The guild deciding what its own roles mean.
 *
 * The split this rests on (docs/guild-and-player-profiles.md §4): the
 * **vocabulary is code** and the **grants are the guild's**. Nothing here can
 * invent a capability, and nothing here refuses a guild a combination it wants
 * — with one exception, below, which is a contradiction rather than a
 * preference.
 *
 * The starter roles have no special status. Member, Raider and Officer are
 * suggestions the way `DEFAULT_POLICY` ships numbers: rename them, recolour
 * them, delete them, replace them. Only *baseline-ness* is structural, because
 * something has to be the floor every membership stands on.
 */

export type RoleProblem =
  | "missing"
  | "name-required"
  | "name-taken"
  | "baseline-escalation"
  | "baseline-undeletable"
  | "unknown-role";

export const ROLE_PROBLEM_TEXT: Record<RoleProblem, string> = {
  missing: "That role no longer exists.",
  "name-required": "A role needs a name.",
  "name-taken": "This guild already has a role with that name.",
  "baseline-escalation":
    "The baseline role can't hand out permissions — every member holds it, so any of them could then grant themselves everything.",
  "baseline-undeletable": "The baseline role can't be deleted. Edit what it grants instead.",
  "unknown-role": "One of those roles doesn't belong to this guild.",
};

export type RoleResult<T = void> = { ok: true; value: T } | { ok: false; reason: RoleProblem };

const MAX_NAME = 40;

function audit(
  db: ReturnType<typeof getDb>,
  guildId: string,
  kind: string,
  actor: string,
  detail: string,
  at: string,
): void {
  insertGuildAuditEntry(db, {
    id: `aud_${randomBytes(8).toString("hex")}`,
    guildId,
    kind,
    actor,
    detail,
    at,
  });
}

/** Human-readable grant list for an audit line: names, not ids nobody reads. */
function describe(capabilities: readonly Capability[]): string {
  if (capabilities.length === 0) return "nothing";
  return capabilities.map((c) => CAPABILITIES[c].label).join(", ");
}

function nameTaken(roles: readonly GuildRole[], name: string, exceptId?: string): boolean {
  const wanted = name.trim().toLocaleLowerCase();
  return roles.some((r) => r.id !== exceptId && r.name.trim().toLocaleLowerCase() === wanted);
}

export interface RoleDraft {
  name: string;
  colour?: string;
  capabilities: readonly string[];
}

/** Create a role. Never baseline — a guild has exactly one and it already exists. */
export function createRole(input: {
  guildId: string;
  draft: RoleDraft;
  actor: string;
  now?: string;
}): RoleResult<GuildRole> {
  const db = getDb();
  const now = input.now ?? new Date().toISOString();
  const name = input.draft.name.trim().slice(0, MAX_NAME);
  if (!name) return { ok: false, reason: "name-required" };

  return withTx(db, () => {
    const roles = loadStore(db).guildRoles.filter((r) => r.guildId === input.guildId);
    if (nameTaken(roles, name)) return { ok: false, reason: "name-taken" } as const;

    const capabilities = sanitizeCapabilities(input.draft.capabilities);
    const role: GuildRole = {
      id: `role_${randomBytes(8).toString("hex")}`,
      guildId: input.guildId,
      name,
      colour: input.draft.colour,
      sort: roles.length,
      capabilities,
      baseline: false,
    };
    insertGuildRole(db, role);
    audit(db, input.guildId, "role.created", input.actor, `${input.actor} created the role ${name}, granting ${describe(capabilities)}.`, now);
    bumpDataVersion(db);
    return { ok: true, value: role } as const;
  });
}

/**
 * Change a role's name, colour or grants.
 *
 * The baseline check happens here rather than at the checkbox, so it holds
 * however the call arrives. It refuses the whole edit instead of quietly
 * dropping the offending capability: silently saving something other than what
 * an officer ticked is worse than saying no.
 */
export function updateRole(input: {
  guildId: string;
  roleId: string;
  draft: Partial<RoleDraft>;
  actor: string;
  now?: string;
}): RoleResult<GuildRole> {
  const db = getDb();
  const now = input.now ?? new Date().toISOString();

  return withTx(db, () => {
    const roles = loadStore(db).guildRoles.filter((r) => r.guildId === input.guildId);
    const existing = roles.find((r) => r.id === input.roleId);
    if (!existing) return { ok: false, reason: "missing" } as const;

    const name = input.draft.name === undefined ? existing.name : input.draft.name.trim().slice(0, MAX_NAME);
    if (!name) return { ok: false, reason: "name-required" } as const;
    if (nameTaken(roles, name, existing.id)) return { ok: false, reason: "name-taken" } as const;

    /*
     * `stored` is what goes back in the row; `effective` is what the code can
     * actually act on. They differ when a role still names a capability a later
     * release retired — and a rename must not silently drop those, so only an
     * explicit regrant rewrites the list.
     */
    const stored = input.draft.capabilities === undefined ? existing.capabilities : [...input.draft.capabilities];
    const effective = sanitizeCapabilities(stored);

    if (existing.baseline && baselineViolations(effective).length > 0) {
      return { ok: false, reason: "baseline-escalation" } as const;
    }

    const next: GuildRole = {
      ...existing,
      name,
      colour: input.draft.colour === undefined ? existing.colour : input.draft.colour || undefined,
      capabilities: stored,
    };
    insertGuildRole(db, next);

    // Two different edits, and an officer reading the log later wants to know
    // which: a rename is bookkeeping, a change of grants is a decision.
    const renamed = existing.name !== name;
    const regranted = input.draft.capabilities !== undefined;
    const detail = regranted
      ? `${input.actor} set ${name} to grant ${describe(effective)}.`
      : `${input.actor} renamed ${existing.name} to ${name}.`;
    if (renamed || regranted) {
      audit(db, input.guildId, regranted ? "role.regranted" : "role.renamed", input.actor, detail, now);
    }
    bumpDataVersion(db);
    return { ok: true, value: next } as const;
  });
}

/**
 * Delete a role and take it off everyone who held it.
 *
 * `deleteGuildRole` does both halves. Skipping the second leaves memberships
 * pointing at an id nothing resolves, which trips `validateStore` on the next
 * read-model rebuild — minutes later, on an unrelated write, reading as a
 * corrupt database.
 */
export function deleteRole(input: {
  guildId: string;
  roleId: string;
  actor: string;
  now?: string;
}): RoleResult {
  const db = getDb();
  const now = input.now ?? new Date().toISOString();

  return withTx(db, () => {
    const role = loadStore(db).guildRoles.find((r) => r.id === input.roleId && r.guildId === input.guildId);
    if (!role) return { ok: false, reason: "missing" } as const;
    if (role.baseline) return { ok: false, reason: "baseline-undeletable" } as const;

    const held = loadStore(db).memberships.filter((m) => m.roleIds.includes(role.id)).length;
    deleteGuildRole(db, role.id);
    audit(
      db,
      input.guildId,
      "role.deleted",
      input.actor,
      `${input.actor} deleted the role ${role.name}${held > 0 ? `, removing it from ${held} member${held === 1 ? "" : "s"}` : ""}.`,
      now,
    );
    bumpDataVersion(db);
    return { ok: true, value: undefined } as const;
  });
}

/**
 * Set which roles a member holds.
 *
 * Owners are allowed to hold roles and it changes nothing — they hold every
 * capability implicitly, and stripping their roles cannot lock them out. That
 * is deliberate: ownership is not a role, so nothing here can take it away
 * either.
 */
export function setMemberRoles(input: {
  guildId: string;
  membershipId: string;
  roleIds: readonly string[];
  actor: string;
  now?: string;
}): RoleResult {
  const db = getDb();
  const now = input.now ?? new Date().toISOString();

  return withTx(db, () => {
    const membership = getMembership(db, input.membershipId);
    if (!membership || membership.guildId !== input.guildId) return { ok: false, reason: "missing" } as const;

    const store = loadStore(db);
    const known = new Map(store.guildRoles.filter((r) => r.guildId === input.guildId).map((r) => [r.id, r]));
    // Refuse rather than filter: an id we do not recognise means the form was
    // built against a different guild or a stale page, and quietly saving the
    // subset we did recognise would look like it worked.
    const wanted = [...new Set(input.roleIds)];
    if (wanted.some((id) => !known.has(id))) return { ok: false, reason: "unknown-role" } as const;

    // The baseline is held by everyone without being listed on anybody. Storing
    // it on a membership would make it look optional on the one row that has it.
    const roleIds = wanted.filter((id) => !known.get(id)!.baseline);

    setMembershipRoles(db, membership.id, roleIds);
    audit(
      db,
      input.guildId,
      "member.roles",
      input.actor,
      `${input.actor} set ${membership.displayName}'s roles to ${
        roleIds.length > 0 ? roleIds.map((id) => known.get(id)!.name).join(", ") : "the baseline alone"
      }.`,
      now,
    );
    bumpDataVersion(db);
    return { ok: true, value: undefined } as const;
  });
}
