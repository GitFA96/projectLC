"use server";

import { randomBytes } from "node:crypto";
import { actingOfficer } from "@/app/acting-officer";
import { requireCapability } from "@/lib/auth/can";
import { resolveViewer } from "@/lib/auth/viewer";
import { CLAIM_PROBLEM_TEXT, linkCharacter, unlinkCharacter } from "@/lib/auth/claims";
import { INVITE_PROBLEM_TEXT, issueInvite, revokeInvite } from "@/lib/auth/invites";
import { ROLE_PROBLEM_TEXT, setMemberRoles } from "@/lib/auth/roles";
import { addGuildOwner, deleteMembership, getDb, insertGuildAuditEntry, removeGuildOwner } from "@/lib/data/db";
import { getRepo } from "@/lib/data/repo";
import { refreshAfterWrite } from "@/lib/refresh";

/**
 * Officer actions on the members screen.
 *
 * Every one is gated on `members.manage` — the capability that means "decide
 * who is in this guild, what they play, and which of the guild's roles they
 * hold". Defining what a role *grants* is a bigger power and lives behind
 * `roles.manage` in /guild/roles.
 *
 * **These reach the auth layer, not `getWriteRepo()`.** Identity writes are the
 * documented exception to the repo boundary: an invite has rules — hashing,
 * single use, one transaction — that exist in exactly one place, and routing
 * them through `WriteRepo` would either duplicate those rules or make it a
 * passthrough that pretends to own something it doesn't. Reads still come
 * through the repo. See `src/app/AGENTS.md`.
 */

export interface MembersActionResult {
  ok: boolean;
  message: string;
  /**
   * The invite code, present exactly once — on the response that created it.
   * It is never stored in plaintext and cannot be fetched again.
   */
  code?: string;
}


/**
 * Invite somebody to play a character already on the roster.
 *
 * The code comes back once, in the result. Nothing can recover it afterwards —
 * only its SHA-256 is stored — so an officer who loses it issues another, which
 * supersedes this one.
 */
export async function issueInviteAction(characterId: string, roleIds: string[]): Promise<MembersActionResult> {
  try {
    requireCapability(await resolveViewer(), "members.manage");
    const { guildId, membershipId, actor } = await actingOfficer();

    const result = issueInvite({
      guildId,
      characterId,
      roleIds,
      createdBy: membershipId ?? "system",
      actor,
    });
    if (!result.ok) return { ok: false, message: INVITE_PROBLEM_TEXT[result.reason] };

    refreshAfterWrite("/roster/members");
    return {
      ok: true,
      message: "Invitation created. Copy the code now — it cannot be shown again.",
      code: result.issued.code,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not create the invitation." };
  }
}

/** Withdraw an invitation nobody has used yet. */
export async function revokeInviteAction(inviteId: string): Promise<MembersActionResult> {
  try {
    requireCapability(await resolveViewer(), "members.manage");
    const { guildId, actor } = await actingOfficer();

    if (!revokeInvite({ inviteId, guildId, actor })) {
      return { ok: false, message: "That invitation is gone or has already been used." };
    }
    refreshAfterWrite("/roster/members");
    return { ok: true, message: "Invitation withdrawn. The code no longer works." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not withdraw the invitation." };
  }
}

/**
 * Say which member plays a character, without an invitation.
 *
 * The founder's own character is the case this exists for: claiming a
 * deployment makes somebody the owner of a guild, which is a different fact
 * from which raider they are.
 */
export async function linkCharacterAction(characterId: string, membershipId: string): Promise<MembersActionResult> {
  try {
    requireCapability(await resolveViewer(), "members.manage");
    const { guildId, actor } = await actingOfficer();

    const result = linkCharacter({ guildId, characterId, membershipId, actor });
    if (!result.ok) return { ok: false, message: CLAIM_PROBLEM_TEXT[result.reason] };

    refreshAfterWrite("/roster/members");
    // The character's own page shows who plays it.
    refreshAfterWrite("/roster");
    return { ok: true, message: "Linked." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not link that character." };
  }
}

/** Hand a character back to nobody. The character and its history are untouched. */
export async function unlinkCharacterAction(characterId: string): Promise<MembersActionResult> {
  try {
    requireCapability(await resolveViewer(), "members.manage");
    const { guildId, actor } = await actingOfficer();

    const result = unlinkCharacter({ guildId, characterId, actor });
    if (!result.ok) return { ok: false, message: CLAIM_PROBLEM_TEXT[result.reason] };

    refreshAfterWrite("/roster/members");
    refreshAfterWrite("/roster");
    return { ok: true, message: "Unlinked. Nothing about the character or its awards has changed." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not unlink that character." };
  }
}

/**
 * Hand somebody the roles this guild has already agreed on.
 *
 * `members.manage`, not `roles.manage`: handing out an existing role and
 * deciding what that role *means* are different powers, and an officer who can
 * do the first should not automatically be able to do the second — the second
 * is guild-master-equivalent.
 */
export async function setMemberRolesAction(
  membershipId: string,
  roleIds: string[],
): Promise<MembersActionResult> {
  try {
    requireCapability(await resolveViewer(), "members.manage");
    const { guildId, actor } = await actingOfficer();

    const result = setMemberRoles({ guildId, membershipId, roleIds, actor });
    if (!result.ok) return { ok: false, message: ROLE_PROBLEM_TEXT[result.reason] };

    refreshAfterWrite("/roster/members");
    return { ok: true, message: "Roles saved." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not change those roles." };
  }
}

/**
 * Remove somebody from the guild.
 *
 * **Their characters are unlinked, never deleted** — invariant 6. Every award
 * they ever won stays exactly where it is and stays explainable; what goes is
 * the claim saying which account speaks for those characters. That is what
 * makes this safe to offer at all: the destructive-sounding button destroys
 * nothing, and re-inviting them puts it all back.
 *
 * An owner cannot be removed this way. Ownership has rules of its own that
 * `deleteMembership` cannot enforce, so it refuses and asks for the demotion to
 * happen first, deliberately.
 */
export async function removeMemberAction(membershipId: string): Promise<MembersActionResult> {
  try {
    requireCapability(await resolveViewer(), "members.manage");
    const { guildId, actor } = await actingOfficer();

    const view = await (await getRepo()).getMembersView();
    const target = view.members.find((m) => m.membershipId === membershipId);
    if (!target) return { ok: false, message: "That member no longer exists." };

    const result = deleteMembership(getDb(), membershipId);
    if (!result.ok) return { ok: false, message: result.error };

    insertGuildAuditEntry(getDb(), {
      id: `aud_${randomBytes(8).toString("hex")}`,
      guildId,
      kind: "member.removed",
      actor,
      detail: `${actor} removed ${target.displayName} from the guild. ${result.unlinkedCharacters} character${result.unlinkedCharacters === 1 ? "" : "s"} unlinked; nothing was deleted.`,
      at: new Date().toISOString(),
    });

    refreshAfterWrite("/roster/members");
    refreshAfterWrite("/roster");
    return {
      ok: true,
      message: `${target.displayName} removed. ${result.unlinkedCharacters} character${result.unlinkedCharacters === 1 ? " is" : "s are"} now unclaimed — their awards and history are untouched.`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not remove that member." };
  }
}

/**
 * Ownership changes, both directions.
 *
 * **Gated on being an owner, not on a capability.** Ownership is not a role
 * (§4), so there is nothing to grant and nothing `members.manage` should be
 * able to reach — an officer who could appoint owners could appoint themselves,
 * and `members.manage` would quietly become the most powerful grant in the app.
 *
 * The rules about *which* changes are allowed live in `db.ts` with the writers,
 * because they are invariants rather than policy: never zero owners, stepping
 * down is always permitted, and one owner may only remove another who has gone
 * quiet — otherwise co-ownership is a race to remove the other person first.
 */
async function requireOwner(): Promise<{ guildId: string; membershipId: string; actor: string }> {
  const viewer = await resolveViewer();
  if (!viewer.guild?.isGuildMaster) throw new Error("Only an owner of this guild can change who owns it.");
  const { guildId, actor } = await actingOfficer();
  return { guildId, membershipId: viewer.guild.membershipId, actor };
}

export async function addOwnerAction(membershipId: string): Promise<MembersActionResult> {
  try {
    const me = await requireOwner();
    const result = addGuildOwner(getDb(), me.guildId, membershipId, {
      membershipId: me.membershipId,
      name: me.actor,
    });
    if (!result.ok) return { ok: false, message: result.error };

    refreshAfterWrite("/roster/members");
    return { ok: true, message: "They now own this guild too. Co-owners hold everything, always." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not add that owner." };
  }
}

export async function removeOwnerAction(membershipId: string): Promise<MembersActionResult> {
  try {
    const me = await requireOwner();
    /*
     * The inactivity window comes from the guild's own succession setting
     * rather than the writer's default of 30.
     *
     * They are the same question asked twice — "how long is long enough to
     * treat somebody as gone" — and a guild that widened its succession window
     * to 90 days has said what it thinks. Leaving this on 30 would let one
     * owner remove another two months before the guild agreed they were absent.
     */
    const state = await (await getRepo()).getSuccessionState();
    const result = removeGuildOwner(
      getDb(),
      me.guildId,
      membershipId,
      { membershipId: me.membershipId, name: me.actor },
      { inactiveDays: state.windows.administrativeDays },
    );
    if (!result.ok) return { ok: false, message: result.error };

    refreshAfterWrite("/roster/members");
    refreshAfterWrite("/", "layout");
    return {
      ok: true,
      message:
        membershipId === me.membershipId
          ? "You are no longer an owner. Your membership and characters are unchanged."
          : "They are no longer an owner. Their membership and characters are unchanged.",
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not change ownership." };
  }
}
