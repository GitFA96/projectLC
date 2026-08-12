import { NextResponse, type NextRequest } from "next/server";
import { getDb, upsertAccount } from "@/lib/data/db";
import { DiscordAuthError, discordConfigured, exchangeCodeForIdentity } from "@/lib/auth/discord";
import { claimCodeMatches, claimDeployment, deploymentClaimed } from "@/lib/auth/claim";
import { checkInvite, redeemInvite } from "@/lib/auth/invites";
import { createSession, readOAuthState, safeReturnTo, STATE_COOKIE } from "@/lib/auth/session";

/**
 * Coming back from Discord.
 *
 * The order of checks is the security of this route, so it is worth stating:
 * state first (was this sign-in started here, in this browser?), then the code
 * exchange (does Discord agree?), and only then any decision about *which*
 * account the session binds to. Reversing any two of those is how a login ends
 * up bound to somebody else's identity.
 *
 * Every response clears the state cookie, matched or not, so a replayed
 * callback finds nothing waiting.
 *
 * Failures land back on /signin with a short reason. None of them say more than
 * the person needs — whoever is reading may not be who they claim.
 *
 * Three ways in, in order of how rare they are: the one-time deployment claim,
 * an invitation, and an ordinary sign-in by somebody who already belongs here.
 */
function redirect(request: NextRequest, to: URL | string): NextResponse {
  const response = NextResponse.redirect(new URL(to, request.nextUrl.origin), 302);
  response.cookies.delete(STATE_COOKIE);
  return response;
}

function fail(request: NextRequest, reason: string): NextResponse {
  const url = new URL("/signin", request.nextUrl.origin);
  url.searchParams.set("error", reason);
  return redirect(request, url);
}

export async function GET(request: NextRequest): Promise<Response> {
  if (!discordConfigured()) return fail(request, "not-configured");

  const params = request.nextUrl.searchParams;
  // The user pressed Cancel on Discord's consent screen, or Discord refused.
  if (params.get("error")) return fail(request, "declined");

  const code = params.get("code");
  const state = await readOAuthState(params.get("state"));
  if (!code || !state) return fail(request, "expired");

  /*
   * Check the invitation before spending a Discord round trip on it.
   *
   * A dead code is the common failure — expired, already used, withdrawn — and
   * finding out *before* the hop means the person gets told why instead of
   * consenting to an app that then refuses them. It also means no account is
   * created for a sign-in that was never going to work.
   *
   * This is not the check that protects anything; `redeemInvite` re-checks
   * inside its own transaction. This one is for the person holding the code.
   */
  if (state.inviteCode) {
    const preview = checkInvite(state.inviteCode);
    if (!preview.ok) return fail(request, `invite-${preview.reason}`);
  }

  let identity;
  try {
    identity = await exchangeCodeForIdentity(code, state.codeVerifier);
  } catch (e) {
    return fail(request, e instanceof DiscordAuthError ? "discord" : "unknown");
  }

  const now = new Date().toISOString();
  const userAgent = request.headers.get("user-agent") ?? undefined;
  const returnTo = safeReturnTo(state.returnTo);

  let accountId: string;
  if (state.claimCode) {
    // Checked against the live count rather than against what the browser told
    // us, so a stale claim link cannot re-open a deployment somebody owns.
    if (deploymentClaimed()) return fail(request, "already-claimed");
    if (!claimCodeMatches(state.claimCode)) return fail(request, "bad-code");
    try {
      accountId = claimDeployment({ ...identity, now }).accountId;
    } catch {
      return fail(request, "claim-failed");
    }
  } else {
    // Nothing to sign in to yet. Without this, an ordinary sign-in before the
    // claim would mint an account that owns nothing — and used to close the
    // claim page permanently, bricking the deployment from its own front door.
    if (!deploymentClaimed()) return fail(request, "unclaimed");
    const account = upsertAccount(getDb(), { ...identity, now });
    if (account.disabled) return fail(request, "disabled");
    accountId = account.id;

    if (state.inviteCode) {
      // Redeemed as this account, now that Discord has said who they are. An
      // account that already belongs to this guild keeps its membership and
      // simply gains a character — the alt case, which is the ordinary one.
      const redeemed = redeemInvite({
        code: state.inviteCode,
        accountId,
        displayName: identity.discordUsername ?? "Member",
        now,
      });
      if (!redeemed.ok) return fail(request, `invite-${redeemed.reason}`);
    }
  }

  const session = createSession(accountId, userAgent);
  const response = redirect(request, returnTo);
  response.cookies.set(session.name, session.value, session.options);
  return response;
}
