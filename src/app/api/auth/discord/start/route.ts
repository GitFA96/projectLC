import { NextResponse, type NextRequest } from "next/server";
import { authorizeUrl, createPkceVerifier, discordConfigured } from "@/lib/auth/discord";
import { newOAuthState, safeReturnTo } from "@/lib/auth/session";

/**
 * Step out to Discord.
 *
 * GET, because it is a top-level navigation the user initiated by clicking a
 * link — nothing is mutated here beyond a short-lived state cookie, and the
 * session only comes into existence on the way back.
 *
 * What Discord receives is an opaque nonce. The PKCE verifier, the landing page
 * and any claim or invite code stay in the httpOnly cookie: the URL is visible to the
 * browser, to history and to Discord's logs, and the cookie is not.
 *
 * `NextResponse` rather than `Response.redirect`, because this response has to
 * carry a `Set-Cookie` and only the former lets us attach one to it.
 */
export async function GET(request: NextRequest): Promise<Response> {
  if (!discordConfigured()) {
    return new Response(
      "Discord sign-in is not configured. Set DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET and DISCORD_REDIRECT_URI.",
      { status: 503, headers: { "content-type": "text/plain" } },
    );
  }

  const params = request.nextUrl.searchParams;
  const codeVerifier = createPkceVerifier();
  const state = newOAuthState({
    returnTo: safeReturnTo(params.get("returnTo")),
    // Presence is all that matters here; whether the code is right is decided
    // on the way back, against a value only the server has ever seen.
    claimCode: params.get("claim") ?? undefined,
    // Same treatment, for the same reason: an invite code is a key, so it
    // travels in the httpOnly cookie and never in the URL we hand to Discord.
    inviteCode: params.get("invite") ?? undefined,
    codeVerifier,
  });

  const response = NextResponse.redirect(authorizeUrl(state.nonce, codeVerifier), 302);
  response.cookies.set(state.cookie.name, state.cookie.value, state.cookie.options);
  return response;
}
