"use server";

import { randomUUID } from "node:crypto";
import { requireAppAdmin } from "@/lib/auth/can";
import { resolveViewer } from "@/lib/auth/viewer";
import { currentAccount } from "@/lib/auth/session";
import {
  BREAK_GLASS_MAX_MINUTES,
  closeBreakGlass,
  findOpenBreakGlass,
  getDb,
  insertGuildAuditEntry,
  loadStore,
  openBreakGlass,
} from "@/lib/data/db";
import { refreshAfterWrite } from "@/lib/refresh";

/**
 * The operator reaching into a guild they are not a member of.
 *
 * The one exception to §7, and it is built to be uncomfortable rather than
 * convenient — a back door people find pleasant to use stops being an exception
 * and becomes the way things are done.
 *
 * Four things make it not a back door:
 *
 *   - **A reason is required**, and it is the guild that reads it.
 *   - **It expires on its own**, capped at two hours. Nobody has to remember to
 *     close it for the guild to be safe again.
 *   - **Opening it is announced in the guild's own audit log**, immediately —
 *     before anything has been done with it.
 *   - **Every use writes another line**, from `requireCapability`, naming the
 *     capability. That write cannot be forgotten at a call site because no call
 *     site does it.
 */

export interface BreakGlassResult {
  ok: boolean;
  message: string;
}

export async function openBreakGlassAction(
  guildId: string,
  reason: string,
  minutes: number,
): Promise<BreakGlassResult> {
  try {
    requireAppAdmin(await resolveViewer());
    const me = await currentAccount();
    if (!me) return { ok: false, message: "Sign in first." };

    const trimmed = reason.trim();
    // Not a formality. The reason is the only thing the guild has to judge
    // whether the override was warranted, so an empty one defeats the point.
    if (trimmed.length < 10) {
      return { ok: false, message: "Give a real reason — the guild reads this, and it is the whole justification." };
    }

    const db = getDb();
    const store = loadStore(db);
    if (store.guild.id !== guildId) return { ok: false, message: "No such guild on this deployment." };
    if (store.memberships.some((m) => m.accountId === me.id)) {
      return {
        ok: false,
        message: "You are a member of that guild — you already have whatever your membership grants. Break-glass is for guilds you are not in.",
      };
    }
    if (findOpenBreakGlass(db, me.id, guildId)) {
      return { ok: false, message: "You already have an override open for that guild." };
    }

    const glass = openBreakGlass(db, { guildId, accountId: me.id, reason: trimmed, minutes });
    // Announced to the guild the moment it opens, not when it is first used.
    insertGuildAuditEntry(db, {
      id: `aud_${randomUUID().slice(0, 12)}`,
      guildId,
      kind: "break-glass.opened",
      actor: "The service operator",
      reason: glass.reason,
      detail: `An operator opened a break-glass override on this guild until ${glass.expiresAt}. Everything they do with it is logged here.`,
      at: glass.openedAt,
      expiresAt: glass.expiresAt,
    });

    refreshAfterWrite("/service/tenancy");
    refreshAfterWrite("/", "layout");
    return {
      ok: true,
      message: `Open until ${new Date(glass.expiresAt).toLocaleTimeString()}. The guild has been told, and every capability you use is logged in their audit.`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not open an override." };
  }
}

/** Close one early. Expiry already handles the case where nobody remembers. */
export async function closeBreakGlassAction(guildId: string): Promise<BreakGlassResult> {
  try {
    requireAppAdmin(await resolveViewer());
    const me = await currentAccount();
    if (!me) return { ok: false, message: "Sign in first." };

    const db = getDb();
    const glass = findOpenBreakGlass(db, me.id, guildId);
    if (!glass) return { ok: false, message: "Nothing open for that guild." };

    closeBreakGlass(db, glass.id);
    insertGuildAuditEntry(db, {
      id: `aud_${randomUUID().slice(0, 12)}`,
      guildId,
      kind: "break-glass.closed",
      actor: "The service operator",
      detail: "The operator closed their break-glass override.",
      at: new Date().toISOString(),
    });

    refreshAfterWrite("/service/tenancy");
    refreshAfterWrite("/", "layout");
    return { ok: true, message: "Closed. You have no access to that guild again." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not close it." };
  }
}

export { BREAK_GLASS_MAX_MINUTES };
