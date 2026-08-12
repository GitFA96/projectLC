"use server";

import { requireAppAdmin } from "@/lib/auth/can";
import { resolveViewer } from "@/lib/auth/viewer";
import { currentAccount } from "@/lib/auth/session";
import {
  countAppAdmins,
  getAccount,
  getDb,
  purgeExpiredAuthSessions,
  purgeExpiredInvites,
  revokeAccountSessions,
  setAccountAppAdmin,
  setAccountDisabled,
} from "@/lib/data/db";
import { refreshAfterWrite } from "@/lib/refresh";

/**
 * Administering the tenancy — accounts and sessions, not guilds.
 *
 * Nothing here touches a guild's contents. Disabling an account ends that
 * person's access to the whole deployment, which is an operator's call about
 * the service; **removing them from a guild is that guild's call** and lives on
 * `/roster/members`. Keeping the two apart is what stops "operator" quietly
 * becoming "super guild master" (§7).
 *
 * Two guards here are the same shape as "a guild can never have zero owners",
 * because the failure is the same and worse: nobody could reach `/service` to
 * undo it, since reaching `/service` is what the flag grants — and unlike a
 * guild, there is no succession ladder underneath to rescue it.
 */

export interface TenancyActionResult {
  ok: boolean;
  message: string;
}

async function operator(): Promise<{ accountId: string | null }> {
  requireAppAdmin(await resolveViewer());
  const me = await currentAccount();
  return { accountId: me?.id ?? null };
}

/**
 * Stop an account using this deployment at all.
 *
 * `setAccountDisabled` revokes their live sessions as part of the same act —
 * without that, disabling would do nothing until the cookie happened to expire,
 * which is precisely the window you are trying to close.
 */
export async function setAccountDisabledAction(
  accountId: string,
  disabled: boolean,
): Promise<TenancyActionResult> {
  try {
    const me = await operator();
    const db = getDb();
    const target = getAccount(db, accountId);
    if (!target) return { ok: false, message: "That account no longer exists." };

    if (disabled && accountId === me.accountId) {
      return { ok: false, message: "You can't disable your own account — you'd be signing yourself out for good." };
    }
    if (disabled && target.appAdmin && countAppAdmins(db) <= 1) {
      return { ok: false, message: "That's the last operator. Give somebody else the flag first, or nobody can reach this console again." };
    }

    setAccountDisabled(db, accountId, disabled);
    refreshAfterWrite("/service/tenancy");
    return {
      ok: true,
      message: disabled
        ? `${target.discordUsername ?? "That account"} is disabled and their sessions are revoked. Their guild memberships and history are untouched.`
        : `${target.discordUsername ?? "That account"} can sign in again. They will need to.`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not change that account." };
  }
}

/**
 * End every session an account holds, without disabling it.
 *
 * The answer to "I think my cookie leaked": they sign in again immediately and
 * the stolen one is dead. A session is a row rather than a signed token exactly
 * so this can work at all.
 */
export async function revokeSessionsAction(accountId: string): Promise<TenancyActionResult> {
  try {
    await operator();
    const db = getDb();
    const target = getAccount(db, accountId);
    if (!target) return { ok: false, message: "That account no longer exists." };

    const ended = revokeAccountSessions(db, accountId);
    refreshAfterWrite("/service/tenancy");
    return {
      ok: true,
      message: ended === 0 ? "They had no live sessions." : `${ended} session${ended === 1 ? "" : "s"} ended. They will have to sign in again.`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not revoke those sessions." };
  }
}

/** Grant or take away the operator flag. Grants nothing inside any guild (§7). */
export async function setAppAdminAction(accountId: string, appAdmin: boolean): Promise<TenancyActionResult> {
  try {
    const me = await operator();
    const db = getDb();
    const target = getAccount(db, accountId);
    if (!target) return { ok: false, message: "That account no longer exists." };

    if (!appAdmin && countAppAdmins(db) <= 1) {
      return { ok: false, message: "That's the last operator. Removing it would close this console permanently — there is no way back in." };
    }
    if (!appAdmin && accountId === me.accountId) {
      return { ok: false, message: "Have somebody else remove it, so you can't lock yourself out by mistake." };
    }

    setAccountAppAdmin(db, accountId, appAdmin);
    refreshAfterWrite("/service/tenancy");
    return {
      ok: true,
      message: appAdmin
        ? `${target.discordUsername ?? "They"} can now run this deployment. It grants them nothing inside any guild.`
        : `${target.discordUsername ?? "They"} no longer runs this deployment.`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not change that flag." };
  }
}

/**
 * Housekeeping: drop rows that can never authenticate or be redeemed again.
 *
 * Redeemed invites are kept — they record who let whom into a guild, which is
 * exactly the sort of thing somebody has to be able to answer later.
 */
export async function purgeExpiredAction(): Promise<TenancyActionResult> {
  try {
    await operator();
    const db = getDb();
    const now = new Date().toISOString();
    const sessions = purgeExpiredAuthSessions(db, now);
    const invites = purgeExpiredInvites(db, now);

    refreshAfterWrite("/service/tenancy");
    return {
      ok: true,
      message: `Cleared ${sessions} expired session${sessions === 1 ? "" : "s"} and ${invites} lapsed invitation${invites === 1 ? "" : "s"}. Redeemed invitations are kept as the record of who joined.`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not run housekeeping." };
  }
}
