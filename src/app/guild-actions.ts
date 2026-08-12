"use server";

import { randomUUID } from "node:crypto";

import { getWriteRepo } from "@/lib/data/repo";
import { refreshAfterWrite } from "@/lib/refresh";
import { requireCapability } from "@/lib/auth/can";
import { resolveViewer } from "@/lib/auth/viewer";
import type { GuildVisibility, Phase } from "@/lib/types";
import { isGuildVisibility, VISIBILITY_META } from "@/lib/analysis/public-profile";
import { getDb, insertGuildAuditEntry, loadStore, setGuildIdentity, setGuildVisibility } from "@/lib/data/db";

/**
 * Guild-wide settings that are facts about the guild rather than judgements
 * about loot — the loot judgements live in `loot-policy-actions.ts`, and the
 * split is worth keeping: one of these is "where are we", the other is "what
 * do we believe".
 */

export interface GuildActionResult {
  ok: boolean;
  message: string;
}

/**
 * Move the guild to a different phase.
 *
 * Wider than it looks. The active phase decides whether a rare gem reads as
 * acceptable or as behind the tier, which phase the priority sheet and the
 * fairness panel open on, and what "current tier" means to gear grading. That
 * is exactly why it is a control rather than a constant: an officer comparing
 * how the loot would fall under P2 and P3 rules can now do it and put it back.
 */
export async function setActivePhaseAction(phase: Phase): Promise<GuildActionResult> {
  try {
    // Enforcing — see docs/guild-and-player-profiles.md §9 step 6.
    requireCapability(await resolveViewer(), "guild.edit");
    const repo = await getWriteRepo();
    const result = await repo.setActivePhase(phase);
    if (!result.ok) return { ok: false, message: result.error };
    // "layout" — the phase is in the header on every page, not just this one.
    refreshAfterWrite("/", "layout");
    return { ok: true, message: `Phase ${phase} is active. Gem grading and every phase-scoped view follow it.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not change the active phase." };
  }
}

/**
 * Change what this guild publishes to the world.
 *
 * `guild.edit` rather than a visibility-specific capability: it is a fact the
 * guild states about itself, like its realm or its active phase, and inventing
 * a capability for one setting would put a checkbox in the grant editor that
 * gates a single button.
 *
 * Re-validated here even though the picker only offers three values — the
 * client-side control is a convenience, never a guarantee, exactly as with
 * every parsed import.
 */
export async function setGuildVisibilityAction(visibility: GuildVisibility): Promise<GuildActionResult> {
  try {
    requireCapability(await resolveViewer(), "guild.edit");
    if (!isGuildVisibility(visibility)) return { ok: false, message: "That isn't a visibility this app knows." };

    setGuildVisibility(getDb(), visibility);
    // The front door serves a different page depending on this.
    refreshAfterWrite("/", "layout");
    return { ok: true, message: `${VISIBILITY_META[visibility].label}. ${VISIBILITY_META[visibility].blurb}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not change what the guild publishes." };
  }
}

/**
 * Rename the guild, or move it to another realm.
 *
 * `guild.edit`, so an owner does it directly — and so does an **operator with
 * an open break-glass**, which is the one path into a guild the flag alone
 * cannot open. Nothing here special-cases that: `requireCapability` returns the
 * same allowed decision either way and writes the audit line itself. A route
 * that had to know *how* it was permitted would be a route that could get it
 * wrong.
 *
 * The old values go in the audit line. A rename changes what every past
 * decision appears to have been made under, so "it used to be called X" has to
 * stay answerable.
 */
export async function setGuildIdentityAction(input: {
  name: string;
  realm: string;
  faction: string;
}): Promise<GuildActionResult> {
  try {
    const viewer = await resolveViewer();
    requireCapability(viewer, "guild.edit");

    const name = input.name.trim().slice(0, 60);
    const realm = input.realm.trim().slice(0, 60);
    if (!name || !realm) return { ok: false, message: "A guild needs a name and a realm." };
    if (input.faction !== "Horde" && input.faction !== "Alliance") {
      return { ok: false, message: "That isn't a faction this app knows." };
    }

    const db = getDb();
    const before = loadStore(db).guild;
    if (before.name === name && before.realm === realm && before.faction === input.faction) {
      return { ok: true, message: "Nothing changed." };
    }

    setGuildIdentity(db, { name, realm, faction: input.faction });
    insertGuildAuditEntry(db, {
      id: `aud_${randomUUID().slice(0, 12)}`,
      guildId: before.id,
      kind: "guild.renamed",
      actor: viewer.guild ? "An officer" : "The service operator",
      detail: `Guild identity changed from "${before.name} · ${before.realm} · ${before.faction}" to "${name} · ${realm} · ${input.faction}".`,
      at: new Date().toISOString(),
    });

    refreshAfterWrite("/", "layout");
    return { ok: true, message: `Now ${name} · ${realm} · ${input.faction}. The change is in the guild's audit log.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not change the guild's identity." };
  }
}
