/**
 * The Discord OAuth round trip.
 *
 * Discord rather than passwords because a guild already has Discord: the invite
 * lands in the officer channel, nobody is asked to invent another password, and
 * this app never holds a credential worth stealing.
 *
 * **`identify` is the only scope, and it should stay that way.** It returns the
 * user id, name and avatar — exactly what `accounts` stores. Not `email` (we
 * store none) and not `guilds` (we do not read Discord server membership;
 * joining is an officer's judgement, not something inferred). Narrow scope is
 * also what makes the consent screen a raider sees easy to agree to.
 *
 * The access token is used once, here, to read the user's identity, and is
 * then discarded. Nothing stores it: the session that follows is ours, and a
 * Discord token we kept would be a credential we would have to protect.
 */

import { createHash, randomBytes } from "node:crypto";

const AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
const TOKEN_URL = "https://discord.com/api/oauth2/token";
const USER_URL = "https://discord.com/api/users/@me";
const REVOKE_URL = "https://discord.com/api/oauth2/token/revoke";
const SCOPE = "identify";

export interface DiscordIdentity {
  discordId: string;
  discordUsername?: string;
  avatarUrl?: string;
}

export class DiscordAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscordAuthError";
  }
}

function clientId(): string | undefined {
  return process.env.DISCORD_CLIENT_ID?.trim() || undefined;
}
function clientSecret(): string | undefined {
  return process.env.DISCORD_CLIENT_SECRET?.trim() || undefined;
}

/**
 * Read from env rather than derived from the request host: Discord matches the
 * redirect as an exact string, so it has to be the same one that was registered
 * — and localhost and production differ by config, not by code.
 */
export function redirectUri(): string | undefined {
  return process.env.DISCORD_REDIRECT_URI?.trim() || undefined;
}

export function discordConfigured(): boolean {
  return Boolean(clientId() && clientSecret() && redirectUri());
}

/**
 * PKCE. The verifier is a secret we keep; the challenge is its SHA-256, which
 * is what Discord sees on the way out and checks against the verifier on the
 * way back.
 *
 * **Discord does not document PKCE support**, so treat this as opportunistic
 * rather than as a control we rely on. It is sent because OAuth 2.0 requires a
 * server to ignore parameters it does not recognise (RFC 6749 §3.1), so it is
 * free if unsupported and a real second lock if it is. What actually protects
 * the code exchange here is the client secret: we are a confidential client,
 * and an intercepted code cannot be redeemed without it.
 *
 * The verifier never leaves this server — it rides in the httpOnly state
 * cookie, not in the `state` parameter. See newOAuthState().
 */
export function createPkceVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Where to send the browser.
 *
 * `state` is round-tripped by Discord and checked on the way back — without it,
 * an attacker can complete a login in a victim's browser and silently bind
 * their session to the attacker's account.
 */
export function authorizeUrl(state: string, codeVerifier: string): string {
  const id = clientId();
  const uri = redirectUri();
  if (!id || !uri) throw new DiscordAuthError("Discord sign-in is not configured.");
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: uri,
    response_type: "code",
    scope: SCOPE,
    state,
    code_challenge: pkceChallenge(codeVerifier),
    code_challenge_method: "S256",
    // `prompt` is deliberately unset. Forcing the consent screen on every
    // sign-in is friction with no security return: the risk it looks like it
    // addresses — a login the user did not start — is what `state` handles, and
    // the worst a stray /start link can do is sign somebody in as themselves.
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Trade the one-time code for the user's identity.
 *
 * Both calls happen here so the access token never leaves this function. A
 * route handler calling out to Discord is fine — the "nothing fetches while
 * rendering" rule is about *pages*, and this is a request the user just made.
 */
export async function exchangeCodeForIdentity(
  code: string,
  codeVerifier: string,
): Promise<DiscordIdentity> {
  const id = clientId();
  const secret = clientSecret();
  const uri = redirectUri();
  if (!id || !secret || !uri) throw new DiscordAuthError("Discord sign-in is not configured.");

  const tokenResponse = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      grant_type: "authorization_code",
      code,
      redirect_uri: uri,
      code_verifier: codeVerifier,
    }),
    cache: "no-store",
  });
  if (!tokenResponse.ok) {
    // Discord's body echoes the request; don't surface it, it can carry the code.
    throw new DiscordAuthError(`Discord rejected the sign-in (${tokenResponse.status}).`);
  }
  const token = (await tokenResponse.json()) as { access_token?: string };
  if (!token.access_token) throw new DiscordAuthError("Discord returned no access token.");

  const userResponse = await fetch(USER_URL, {
    headers: { authorization: `Bearer ${token.access_token}` },
    cache: "no-store",
  });
  if (!userResponse.ok) {
    throw new DiscordAuthError(`Could not read your Discord profile (${userResponse.status}).`);
  }
  const user = (await userResponse.json()) as {
    id?: string;
    username?: string;
    global_name?: string | null;
    avatar?: string | null;
  };
  if (!user.id) throw new DiscordAuthError("Discord returned no user id.");

  // We needed the token for exactly one call. Handing it back shortens its life
  // from days to seconds; Discord's docs note that revoking also kills any
  // refresh token issued with it. Best-effort on purpose — a failed revoke must
  // not fail a sign-in that has otherwise succeeded.
  await revokeToken(token.access_token);

  return {
    discordId: user.id,
    // `global_name` is the display name Discord shows now; `username` is the
    // handle. Prefer what the person's guildmates would recognise.
    discordUsername: user.global_name ?? user.username ?? undefined,
    avatarUrl: user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
      : undefined,
  };
}

/**
 * Hand an access token back to Discord.
 *
 * Both the token and revocation endpoints accept `application/x-www-form-urlencoded`
 * and nothing else, per Discord's OAuth2 documentation.
 */
async function revokeToken(accessToken: string): Promise<void> {
  const id = clientId();
  const secret = clientSecret();
  if (!id || !secret) return;
  try {
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: id,
        client_secret: secret,
        token: accessToken,
        token_type_hint: "access_token",
      }),
      cache: "no-store",
    });
  } catch {
    // Nothing to do and nothing to tell the user: the token expires on its own.
  }
}
