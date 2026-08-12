"use server";

import { actingOfficer } from "@/app/acting-officer";
import { requireCapability } from "@/lib/auth/can";
import { resolveViewer } from "@/lib/auth/viewer";
import { createRole, deleteRole, ROLE_PROBLEM_TEXT, updateRole, type RoleDraft } from "@/lib/auth/roles";
import { refreshAfterWrite } from "@/lib/refresh";

/**
 * Defining what this guild's roles mean.
 *
 * Gated on `roles.manage`, which is guild-master-equivalent by construction:
 * anyone holding it can grant themselves anything. That is stated in the
 * vocabulary (`GUILD_MASTER_EQUIVALENT`) and said out loud in the editor,
 * because a guild master who hands out "just the role editor" has in fact
 * handed out the guild.
 *
 * *Assigning* an existing role to somebody is a different, smaller act and is
 * gated on `members.manage` over in the members screen — you can hand out the
 * roles the guild has agreed on without being able to redefine them.
 */

export interface RolesActionResult {
  ok: boolean;
  message: string;
}


function refresh(): void {
  refreshAfterWrite("/guild/roles");
  // Roles are shown against every member, and the invite form offers them.
  refreshAfterWrite("/roster/members");
}

export async function createRoleAction(draft: RoleDraft): Promise<RolesActionResult> {
  try {
    requireCapability(await resolveViewer(), "roles.manage");
    const { guildId, actor } = await actingOfficer();

    const result = createRole({ guildId, draft, actor });
    if (!result.ok) return { ok: false, message: ROLE_PROBLEM_TEXT[result.reason] };

    refresh();
    return { ok: true, message: `Created ${result.value.name}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not create that role." };
  }
}

export async function updateRoleAction(
  roleId: string,
  draft: Partial<RoleDraft>,
): Promise<RolesActionResult> {
  try {
    requireCapability(await resolveViewer(), "roles.manage");
    const { guildId, actor } = await actingOfficer();

    const result = updateRole({ guildId, roleId, draft, actor });
    if (!result.ok) return { ok: false, message: ROLE_PROBLEM_TEXT[result.reason] };

    refresh();
    return { ok: true, message: `Saved ${result.value.name}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not save that role." };
  }
}

/**
 * Delete a role, and take it off everyone who held it.
 *
 * Not destructive in the way it sounds: a role is a bundle of grants, so this
 * removes permissions rather than any record of anything. Nobody loses their
 * membership, their characters or their history.
 */
export async function deleteRoleAction(roleId: string): Promise<RolesActionResult> {
  try {
    requireCapability(await resolveViewer(), "roles.manage");
    const { guildId, actor } = await actingOfficer();

    const result = deleteRole({ guildId, roleId, actor });
    if (!result.ok) return { ok: false, message: ROLE_PROBLEM_TEXT[result.reason] };

    refresh();
    return { ok: true, message: "Role deleted, and removed from everyone who held it." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not delete that role." };
  }
}
