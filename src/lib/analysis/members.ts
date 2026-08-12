import type { Capability } from "@/lib/auth/capabilities";
import { expandCapabilities, sanitizeCapabilities } from "@/lib/auth/capabilities";
import type { Character, GuildInvite, GuildRole, Membership, WowClass } from "@/lib/types";

import { compareText } from "@/lib/sort";

/**
 * The guild seen as **people** rather than as characters.
 *
 * Every other view in this app is keyed on a character, because that is what
 * loot is awarded to. This one is keyed on a membership, because that is what
 * permissions and invitations attach to — and the gap between the two lists is
 * the interesting part. A roster of ninety with four memberships is not a bug;
 * it is a guild that has barely started signing people up, and the screen has
 * to say so plainly rather than look empty.
 *
 * Pure over its inputs, like everything in this directory. `lastSeenAt` arrives
 * as an argument rather than being looked up here because it lives on
 * `accounts`, which is deliberately outside the read model (see
 * `src/lib/data/AGENTS.md`): a login must not rebuild the store.
 */

export interface MemberCharacter {
  id: string;
  name: string;
  wowClass: WowClass;
  status: Character["status"];
}

export interface MemberRow {
  membershipId: string;
  displayName: string;
  /** Owners hold every capability implicitly, so their role list is meaningless. */
  isGuildMaster: boolean;
  roles: { id: string; name: string; colour?: string }[];
  /** Effective grants, implications expanded. Empty for an owner — see above. */
  capabilities: Capability[];
  characters: MemberCharacter[];
  joinedAt: string;
  /** ISO, or null when this person has never signed in. */
  lastSeenAt: string | null;
}

export type InviteState = "live" | "expired";

export interface InviteRow {
  id: string;
  characterId: string;
  /** Null when the character was deleted after the invite went out. */
  characterName: string | null;
  wowClass: WowClass | null;
  roleNames: string[];
  createdAt: string;
  expiresAt: string;
  state: InviteState;
}

export interface RoleRow {
  id: string;
  name: string;
  colour?: string;
  baseline: boolean;
  /**
   * What is actually ticked on this role — **not** the expanded set.
   *
   * The distinction matters in the editor: showing implied capabilities as if
   * they were chosen means the next save writes them in as explicit grants, and
   * the reason each one is held is lost. `implies` stays a fact about the
   * vocabulary rather than something that leaks into the data.
   */
  capabilities: Capability[];
  /** How many memberships hold it. Zero is worth seeing before deleting one. */
  memberCount: number;
}

export interface MembersView {
  members: MemberRow[];
  /** Unredeemed invitations only. A redeemed one is history, not a pending act. */
  invites: InviteRow[];
  /** Roster characters nobody has claimed — who an officer can still invite. */
  unclaimed: MemberCharacter[];
  /**
   * The guild's roles, for the invitation form and the grant editor. The
   * baseline is marked rather than hidden: an officer choosing what an invite
   * grants should be able to see what everybody already gets without picking
   * anything.
   */
  roles: RoleRow[];
  /** How many owners this guild has. Never zero; more than one is normal. */
  ownerCount: number;
}

export interface MembersViewInput {
  memberships: readonly Membership[];
  roles: readonly GuildRole[];
  roster: readonly Character[];
  invites: readonly GuildInvite[];
  /** membershipId → last seen, for the accounts behind these memberships. */
  lastSeen?: Readonly<Record<string, string | null>>;
}


function toMemberCharacter(c: Character): MemberCharacter {
  return { id: c.id, name: c.name, wowClass: c.class, status: c.status };
}

/**
 * Build the screen.
 *
 * Sorted owners first, then by name: the people who can fix a permissions
 * problem should not be somewhere down a list of ninety.
 */
export function buildMembersView(input: MembersViewInput, now: string): MembersView {
  const roleById = new Map(input.roles.map((r) => [r.id, r]));
  const baseline = input.roles.filter((r) => r.baseline);

  const claimedBy = new Map<string, Character[]>();
  for (const character of input.roster) {
    if (!character.membershipId) continue;
    const list = claimedBy.get(character.membershipId) ?? [];
    list.push(character);
    claimedBy.set(character.membershipId, list);
  }

  const members: MemberRow[] = input.memberships.map((m) => {
    const roles = m.roleIds.map((id) => roleById.get(id)).filter((r): r is GuildRole => r !== undefined);
    // The baseline role is held by everyone without being listed on anybody, so
    // it has to be folded in here or the screen understates what a member can do.
    const granted = [...roles, ...baseline].flatMap((r) => r.capabilities);
    return {
      membershipId: m.id,
      displayName: m.displayName,
      isGuildMaster: m.isGuildMaster,
      roles: roles.map((r) => ({ id: r.id, name: r.name, colour: r.colour })),
      capabilities: m.isGuildMaster ? [] : [...expandCapabilities(sanitizeCapabilities(granted))].sort(),
      characters: (claimedBy.get(m.id) ?? []).map(toMemberCharacter).sort((a, b) => compareText(a.name, b.name)),
      joinedAt: m.joinedAt,
      lastSeenAt: input.lastSeen?.[m.id] ?? null,
    };
  });

  members.sort((a, b) => {
    if (a.isGuildMaster !== b.isGuildMaster) return a.isGuildMaster ? -1 : 1;
    return compareText(a.displayName, b.displayName);
  });

  const characterById = new Map(input.roster.map((c) => [c.id, c]));
  const invites: InviteRow[] = input.invites
    .filter((i) => !i.redeemedAt)
    .map((i): InviteRow => {
      const character = characterById.get(i.characterId);
      return {
        id: i.id,
        characterId: i.characterId,
        characterName: character?.name ?? null,
        wowClass: character?.class ?? null,
        roleNames: i.roleIds.map((id) => roleById.get(id)?.name).filter((n): n is string => n !== undefined),
        createdAt: i.createdAt,
        expiresAt: i.expiresAt,
        state: Date.parse(i.expiresAt) <= Date.parse(now) ? "expired" : "live",
      };
    })
    .sort((a, b) => compareText(b.createdAt, a.createdAt));

  const invited = new Set(invites.filter((i) => i.state === "live").map((i) => i.characterId));
  const unclaimed = input.roster
    .filter((c) => !c.membershipId && !invited.has(c.id))
    // A pug is somebody else's raider who came once. Inviting one to join the
    // guild's own tool is not a thing an officer is trying to do, and leaving
    // them in buries the real candidates under years of one-night visitors.
    .filter((c) => c.status !== "pug")
    .map(toMemberCharacter)
    .sort((a, b) => compareText(a.name, b.name));

  return {
    members,
    invites,
    unclaimed,
    roles: input.roles.map((r) => ({
      id: r.id,
      name: r.name,
      colour: r.colour,
      baseline: r.baseline,
      capabilities: sanitizeCapabilities(r.capabilities),
      // The baseline is held by everybody without being listed on anybody, so
      // counting rows that name it would report zero for the one role all of
      // them hold.
      memberCount: r.baseline
        ? input.memberships.length
        : input.memberships.filter((m) => m.roleIds.includes(r.id)).length,
    })),
    ownerCount: members.filter((m) => m.isGuildMaster).length,
  };
}
