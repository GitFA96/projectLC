"use server";

import { requireCapability } from "@/lib/auth/can";
import { resolveViewer } from "@/lib/auth/viewer";
import { clampWindows, mayClaimOwnership, SUCCESSION_BOUNDS } from "@/lib/auth/succession";
import { addGuildOwner, getDb } from "@/lib/data/db";
import { getRepo } from "@/lib/data/repo";
import { refreshAfterWrite } from "@/lib/refresh";

/**
 * What a guild does when everyone who owns it has gone.
 *
 * Ownership is not a capability — that is what makes a guild whose owners all
 * vanish unable to appoint anyone, and it is why this exists at all. Every
 * other route into ownership requires an existing owner to act; this one
 * requires only that no owner has acted *for long enough*.
 *
 * The rules live in `src/lib/auth/succession.ts`, pure and tested against a
 * clock passed in, so "what would this say in forty days" is answerable without
 * waiting forty days. Nothing here re-implements them.
 */

export interface SuccessionActionResult {
  ok: boolean;
  message: string;
}

/**
 * Set how long this guild tolerates silence.
 *
 * `guild.edit`, because it is a fact the guild states about itself. Bounded
 * rather than free: an owner who could set it to ten years would defeat the one
 * protection that exists to guard a guild *from* an absent owner, and one who
 * could set it to a day would let a fortnight's holiday cost somebody their
 * guild. `clampWindows` decides both ends.
 */
export async function setSuccessionWindowsAction(
  administrativeDays: number,
  memberDays: number,
): Promise<SuccessionActionResult> {
  try {
    requireCapability(await resolveViewer(), "guild.edit");
    const windows = clampWindows({ administrativeDays, memberDays });

    const { setSuccessionWindows } = await import("@/lib/data/db");
    setSuccessionWindows(getDb(), windows.administrativeDays, windows.memberDays);
    refreshAfterWrite("/");
    refreshAfterWrite("/roster/members");

    const clamped = windows.administrativeDays !== Math.round(administrativeDays) || windows.memberDays !== Math.round(memberDays);
    return {
      ok: true,
      message: clamped
        ? `Saved as ${windows.administrativeDays} and ${windows.memberDays} days — the app keeps these between ${SUCCESSION_BOUNDS.min} and ${SUCCESSION_BOUNDS.max}, and the second can never come first.`
        : `Saved. Officers may step in after ${windows.administrativeDays} days of silence from every owner, any member after ${windows.memberDays}.`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not save those windows." };
  }
}

/**
 * Take ownership of a guild whose owners have all gone quiet.
 *
 * **Deliberately gated on nothing but eligibility.** A capability check here
 * would be circular: the situation this exists for is one where nobody can
 * grant anything, because granting requires an owner. What stands in its place
 * is `mayClaimOwnership`, computed from how long every owner has been silent
 * and what the claimant holds — and it is re-computed here rather than trusted
 * from the page, because the page's answer is stale the moment it renders.
 *
 * **Adds an owner; never removes one.** The absent owners keep their ownership.
 * If they come back, the guild has two owners and a conversation to have —
 * which is a far better outcome than an automated system having removed
 * somebody who was in hospital.
 */
export async function claimOwnershipAction(): Promise<SuccessionActionResult> {
  try {
    const viewer = await resolveViewer();
    if (!viewer.guild) return { ok: false, message: "Only a member of this guild can do that." };

    const repo = await getRepo();
    const [state, view] = await Promise.all([repo.getSuccessionState(), repo.getMembersView()]);
    const me = view.members.find((m) => m.membershipId === viewer.guild!.membershipId);

    if (!mayClaimOwnership(state, viewer.guild.membershipId)) {
      return {
        ok: false,
        message:
          state.status === "healthy" || state.status === "warning"
            ? "This guild still has an owner who has been here recently."
            : "You are not eligible to take ownership of this guild yet.",
      };
    }

    /*
     * `addGuildOwner` opens its own transaction and writes its own audit line,
     * so this neither wraps it nor logs beside it. Wrapping would nest a BEGIN,
     * which SQLite does not have, and a second entry
     * would tell the same story twice with different words. The reason rides
     * along on the actor instead, which is what puts "no owner had been seen
     * for N days" in the guild's own log next to the change it explains.
     */
    const result = addGuildOwner(getDb(), viewer.guild.guildId, viewer.guild.membershipId, {
      membershipId: viewer.guild.membershipId,
      name: me?.displayName ?? "A member",
      reason: `No owner had been seen for ${Math.floor(state.quietDays)} days.`,
    });
    if (!result.ok) return { ok: false, message: result.error };

    refreshAfterWrite("/", "layout");
    return { ok: true, message: "You now own this guild. The previous owners keep their ownership too." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not take ownership." };
  }
}
