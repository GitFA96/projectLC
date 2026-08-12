import { randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import {
  createAuthSession,
  findAuthSession,
  getAccount,
  getDb,
  hashToken,
  revokeAuthSession,
  touchAccountSeen,
} from "@/lib/data/db";
import type { Account } from "@/lib/types";

/**
 * The logged-in browser, and the short-lived state that guards the OAuth hop.
 *
 * Three rules hold everything here together:
 *
 *   - **The database stores hashes, never the value in the cookie.** A dumped
 *     database yields no usable cookies, and there is nothing to leak in a log.
 *   - **A session is looked up, not trusted.** The cookie carries no claims —
 *     no account id, no role, no expiry we believe. It is a random string whose
 *     only meaning is which row it finds, so revoking that row ends it
 *     immediately. That is the whole reason this is a table rather than a
 *     signed cookie.
 *   - **Nothing here sets a cookie.** Writers return the value and the options;
 *     the route handler puts them on the `NextResponse` it is about to return.
 *     `cookies().set()` is documented for route handlers, but pairing it with a
 *     bare `Response.redirect()` — which builds its own response — is how a
 *     `Set-Cookie` goes silently missing and sign-in appears to work while
 *     never actually logging anybody in.
 */

const SESSION_COOKIE = "projectlc_session";
export const STATE_COOKIE = "projectlc_oauth_state";

const SESSION_DAYS = 30;
/** Long enough to sign in to Discord, short enough that a stale tab just retries. */
const STATE_MINUTES = 10;
/** How stale `last_seen_at` may get before a request refreshes it. */
const SEEN_THROTTLE_MS = 60 * 60 * 1000;

/** Secure only in production: a localhost dev server is plain HTTP. */
function secureCookies(): boolean {
  return process.env.NODE_ENV === "production";
}

function token(): string {
  return randomBytes(32).toString("base64url");
}

/** Constant-time compare that tolerates length differences. */
function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export interface CookieWrite {
  name: string;
  value: string;
  options: {
    httpOnly: true;
    /**
     * "lax" rather than "strict": the browser arrives back from Discord as a
     * top-level navigation, and "strict" would withhold the cookie on exactly
     * that hop. Lax still blocks the cross-site POSTs that matter.
     */
    sameSite: "lax";
    secure: boolean;
    path: "/";
    expires?: Date;
    maxAge?: number;
  };
}

/**
 * Mint a session row and describe the cookie that names it.
 *
 * Always a fresh row and a fresh value — never a reused or "upgraded" one, so a
 * cookie captured before sign-in cannot still be valid after it.
 */
export function createSession(accountId: string, userAgent?: string): CookieWrite {
  const value = token();
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  createAuthSession(getDb(), {
    tokenHash: hashToken(value),
    accountId,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    userAgent: userAgent?.slice(0, 300),
  });

  return {
    name: SESSION_COOKIE,
    value,
    options: { httpOnly: true, sameSite: "lax", secure: secureCookies(), path: "/", expires },
  };
}

/**
 * Who this request belongs to, or null.
 *
 * Every reason to say null is checked here rather than at the call sites:
 * missing cookie, unknown row, revoked, expired, deleted account, disabled
 * account. A caller that forgets one of those would fail open.
 */
export async function currentAccount(): Promise<Account | null> {
  let value: string | undefined;
  try {
    value = (await cookies()).get(SESSION_COOKIE)?.value;
  } catch {
    // No request context (a test, a script). No request, no session.
    return null;
  }
  if (!value) return null;

  const db = getDb();
  const session = findAuthSession(db, hashToken(value));
  if (!session) return null;
  if (session.revokedAt) return null;
  if (Date.parse(session.expiresAt) <= Date.now()) return null;

  const account = getAccount(db, session.accountId);
  if (!account || account.disabled) return null;

  /*
   * Record that they are actually here.
   *
   * Signing in is not activity — a session lasts 30 days — and every succession
   * window is measured against `last_seen_at`. Throttled to an hour because the
   * alternative is a write on every request, and it is deliberately outside the
   * read model so it never invalidates anything.
   */
  const seen = account.lastSeenAt ? Date.parse(account.lastSeenAt) : Number.NaN;
  if (!Number.isFinite(seen) || Date.now() - seen > SEEN_THROTTLE_MS) {
    touchAccountSeen(db, account.id, new Date().toISOString());
  }
  return account;
}

/**
 * Sign out. Called from a Server Action, where `cookies()` may mutate.
 *
 * Revokes the row before clearing the cookie. Clearing the cookie alone leaves
 * a live row that a copy of the cookie could still use — which is precisely the
 * case where somebody signs out because they think it was stolen.
 */
export async function endSession(): Promise<void> {
  const jar = await cookies();
  const value = jar.get(SESSION_COOKIE)?.value;
  if (value) revokeAuthSession(getDb(), hashToken(value), new Date().toISOString());
  jar.delete(SESSION_COOKIE);
}

/* --- OAuth state: login-CSRF protection for the hop out and back. --- */

export interface OAuthState {
  /** The opaque value Discord echoes back. The only part that leaves this server. */
  nonce: string;
  /** Where to land afterwards. Validated on the way back — never trusted raw. */
  returnTo: string;
  /** Set when this is the one-time deployment claim. */
  claimCode?: string;
  /**
   * Set when somebody is redeeming an invitation. In the cookie for the same
   * reason the claim code is: a code in the URL is not a secret, and this one
   * is a key to a character's identity in a guild.
   */
  inviteCode?: string;
  /** The PKCE verifier. Secret, and it stays here. */
  codeVerifier: string;
}

export interface OAuthStateStart {
  /** Send this to Discord as `state`. */
  nonce: string;
  /** Put this on the response as the state cookie. */
  cookie: CookieWrite;
}

/**
 * Start a sign-in.
 *
 * **The `state` parameter is an opaque nonce and nothing else.** Everything
 * secret — the PKCE verifier, the claim code — stays in the httpOnly cookie and
 * never leaves this server.
 *
 * An earlier version encoded the whole payload into `state`, which put the
 * verifier and the claim code into the authorize URL, the browser's history and
 * Discord's request logs. That defeats the entire point of PKCE (a verifier the
 * wire has seen protects nothing) and turns a one-time claim code into
 * something recoverable from a URL bar. The unit test missed it because it
 * exercised `authorizeUrl()` with a handmade state string rather than the one
 * the app actually builds.
 */
export function newOAuthState(input: Omit<OAuthState, "nonce">): OAuthStateStart {
  const full: OAuthState = { ...input, nonce: token() };
  return {
    nonce: full.nonce,
    cookie: {
      name: STATE_COOKIE,
      value: Buffer.from(JSON.stringify(full)).toString("base64url"),
      options: {
        httpOnly: true,
        sameSite: "lax",
        secure: secureCookies(),
        path: "/",
        maxAge: STATE_MINUTES * 60,
      },
    },
  };
}

/**
 * Read the stored state and check it against the nonce Discord returned.
 *
 * Returns null on anything that does not line up, and the caller's only correct
 * response to null is to refuse the sign-in. The caller must also clear the
 * cookie on its response — single use, whether or not it matched, so a replayed
 * callback finds nothing waiting.
 */
export async function readOAuthState(returnedNonce: string | null): Promise<OAuthState | null> {
  if (!returnedNonce) return null;
  let stored: string | undefined;
  try {
    stored = (await cookies()).get(STATE_COOKIE)?.value;
  } catch {
    return null;
  }
  if (!stored) return null;

  let parsed: OAuthState;
  try {
    parsed = JSON.parse(Buffer.from(stored, "base64url").toString("utf8")) as OAuthState;
  } catch {
    return null;
  }
  if (typeof parsed?.nonce !== "string" || typeof parsed?.codeVerifier !== "string") return null;
  if (!sameToken(parsed.nonce, returnedNonce)) return null;
  return parsed;
}

/**
 * Keep a redirect target on this site.
 *
 * `//evil.example` is a protocol-relative URL a browser treats as absolute, so
 * "starts with a slash" is not enough on its own — that is the classic open
 * redirect, and an OAuth callback is exactly where one gets found.
 */
export function safeReturnTo(value: string | null | undefined, fallback = "/"): string {
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}
