import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAuthSession,
  findAuthSession,
  getDb,
  hashToken,
  revokeAuthSession,
  setAccountDisabled,
  upsertAccount,
} from "@/lib/data/db";
import {
  STATE_COOKIE,
  createSession,
  currentAccount,
  endSession,
  newOAuthState,
  readOAuthState,
} from "@/lib/auth/session";

/**
 * The session lifecycle, and the OAuth state on the way back.
 *
 * `oauth.test.ts` owns the other half of this file — `safeReturnTo`, and the
 * property that no secret reaches the authorize URL. What is here is the part
 * with no second reader: `currentAccount` is the only place that decides a
 * request belongs to somebody, and its own doc comment gives the reason every
 * refusal is checked here rather than at the call sites — "a caller that forgets
 * one of those would fail open". Each of those refusals gets a case below, and
 * a run with any one of them deleted is a run where somebody stays signed in
 * after being revoked, expired, deleted or disabled.
 */

const NOW = "2026-08-11T10:00:00.000Z";
const SESSION_COOKIE = "projectlc_session";

const cookies = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ cookies }));

/** Cookies this request arrived with, and what the code did to them. */
function jar(entries: Record<string, string> = {}) {
  const store = new Map(Object.entries(entries));
  const deleted: string[] = [];
  cookies.mockImplementation(async () => ({
    get: (name: string) => (store.has(name) ? { name, value: store.get(name) } : undefined),
    delete: (name: string) => {
      deleted.push(name);
      store.delete(name);
    },
  }));
  return { store, deleted };
}

/** What `cookies()` does when there is no request — a script, or a test. */
function noRequest() {
  cookies.mockImplementation(() => {
    throw new Error("`cookies` was called outside a request scope");
  });
}

function account(discordId = "acct", now = NOW) {
  return upsertAccount(getDb(), { discordId, discordUsername: "Katze", now });
}

beforeEach(() => {
  process.env.PROJECTLC_DB = path.join(mkdtempSync(path.join(tmpdir(), "projectlc-sess-")), "test.db");
  cookies.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("minting a session", () => {
  it("keeps the cookie's value out of the database entirely", () => {
    const me = account();
    const { value } = createSession(me.id);

    // The point of a hashed token: a dumped database yields no usable cookie,
    // and there is nothing in a log worth stealing.
    const dump = getDb()
      .prepare("SELECT * FROM auth_sessions")
      .all()
      .map((row) => JSON.stringify(row))
      .join("");
    expect(dump).not.toContain(value);
    expect(findAuthSession(getDb(), hashToken(value))).toBeDefined();
  });

  it("mints a fresh row and a fresh value every time", () => {
    const me = account();
    const first = createSession(me.id);
    const second = createSession(me.id);

    // Never reused or "upgraded": a cookie captured before sign-in must not
    // still be valid after it.
    expect(first.value).not.toBe(second.value);
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM auth_sessions").get()).toEqual({ n: 2 });
  });

  it("describes the cookie rather than setting one", async () => {
    const me = account();
    const { name, options } = createSession(me.id);

    // Nothing in this module touches the jar. A `Set-Cookie` written here and
    // a `Response.redirect()` built by the caller is how sign-in silently fails
    // to sign anybody in.
    expect(cookies).not.toHaveBeenCalled();
    expect(name).toBe(SESSION_COOKIE);
    expect(options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
  });

  it("expires the cookie in thirty days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    try {
      const { options } = createSession(account().id);
      expect(options.expires?.toISOString()).toBe("2026-09-10T10:00:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("is insecure on a dev server and secure in production", () => {
    const me = account();
    vi.stubEnv("NODE_ENV", "development");
    expect(createSession(me.id).options.secure).toBe(false);
    vi.stubEnv("NODE_ENV", "production");
    expect(createSession(me.id).options.secure).toBe(true);
  });

  it("stores a user agent, and truncates a silly one", () => {
    const me = account();
    const { value } = createSession(me.id, "x".repeat(500));
    expect(findAuthSession(getDb(), hashToken(value))?.userAgent).toHaveLength(300);
  });
});

describe("who a request belongs to", () => {
  /** Sign somebody in and hand back the cookie a browser would send. */
  function signedIn(discordId = "acct") {
    const me = account(discordId);
    const { value } = createSession(me.id);
    return { me, value, jar: jar({ [SESSION_COOKIE]: value }) };
  }

  it("finds the account behind a live cookie", async () => {
    const { me } = signedIn();
    expect((await currentAccount())?.id).toBe(me.id);
  });

  it("says nobody when there is no request at all", async () => {
    noRequest();
    expect(await currentAccount()).toBeNull();
  });

  it("says nobody when the browser sent no session cookie", async () => {
    jar({ someone_elses: "x" });
    expect(await currentAccount()).toBeNull();
  });

  it("says nobody for a token that names no row", async () => {
    signedIn();
    jar({ [SESSION_COOKIE]: "a-token-that-was-never-issued" });
    expect(await currentAccount()).toBeNull();
  });

  it("says nobody once the row is revoked", async () => {
    const { value } = signedIn();
    revokeAuthSession(getDb(), hashToken(value), NOW);
    // The whole reason this is a table and not a signed cookie: revoking ends
    // the session on the next request, with no waiting for an expiry.
    expect(await currentAccount()).toBeNull();
  });

  it("says nobody once the row has expired", async () => {
    const me = account();
    const value = "expired-but-real";
    createAuthSession(getDb(), {
      tokenHash: hashToken(value),
      accountId: me.id,
      createdAt: "2026-07-01T00:00:00.000Z",
      expiresAt: "2026-07-31T00:00:00.000Z",
    });
    jar({ [SESSION_COOKIE]: value });
    expect(await currentAccount()).toBeNull();
  });

  it("cannot be orphaned by a deleted account, and refuses one regardless", async () => {
    const { value } = signedIn();

    // First lock: the schema will not let a session outlive its account.
    expect(() => getDb().prepare("DELETE FROM accounts").run()).toThrow(/FOREIGN KEY/);

    // Second lock: `currentAccount` checks anyway, and turning the constraint
    // off is the only way to build the row it is guarding against. Both are
    // worth having — the day a migration rebuilds `accounts` without the
    // reference, this check is all that stands between a hand-deleted row and
    // a half-formed viewer.
    getDb().exec("PRAGMA foreign_keys = OFF");
    getDb().prepare("DELETE FROM accounts").run();
    getDb().exec("PRAGMA foreign_keys = ON");

    expect(await currentAccount()).toBeNull();
    expect(findAuthSession(getDb(), hashToken(value))).toBeDefined();
  });

  it("says nobody when the account is disabled", async () => {
    const { me } = signedIn();
    setAccountDisabled(getDb(), me.id, true);
    expect(await currentAccount()).toBeNull();
  });

  it("says nobody for a session minted while the account was already disabled", async () => {
    /*
     * The case above passes for two reasons and this one for only one, which is
     * why both are here: `setAccountDisabled` revokes live sessions, so
     * deleting `currentAccount`'s disabled check does not break it — the
     * revoked check catches it instead. A session that never existed to be
     * revoked has nothing but the disabled check standing in front of it.
     */
    const me = account();
    setAccountDisabled(getDb(), me.id, true);
    const { value } = createSession(me.id);
    jar({ [SESSION_COOKIE]: value });

    expect(findAuthSession(getDb(), hashToken(value))?.revokedAt).toBeFalsy();
    expect(await currentAccount()).toBeNull();
  });
});

describe("recording that somebody is actually here", () => {
  // Signing in is not activity — a session lasts thirty days — and every
  // succession window is measured against `last_seen_at`. An account that
  // stopped being touched is an account that can be succeeded early.
  const seenAt = (id: string) =>
    (getDb().prepare("SELECT last_seen_at FROM accounts WHERE id = ?").get(id) as {
      last_seen_at: string | null;
    }).last_seen_at;

  it("touches an account whose last visit is stale", async () => {
    const me = upsertAccount(getDb(), {
      discordId: "stale",
      discordUsername: "Katze",
      now: "2026-01-01T00:00:00.000Z",
    });
    const { value } = createSession(me.id);
    jar({ [SESSION_COOKIE]: value });

    await currentAccount();
    expect(Date.parse(seenAt(me.id)!)).toBeGreaterThan(Date.parse("2026-01-01T00:00:00.000Z"));
  });

  it("leaves a recent one alone", async () => {
    const me = account("fresh", new Date().toISOString());
    const { value } = createSession(me.id);
    jar({ [SESSION_COOKIE]: value });
    const before = seenAt(me.id);

    // Throttled to an hour, because the alternative is a write on every single
    // request just to say somebody loaded a page.
    await currentAccount();
    expect(seenAt(me.id)).toBe(before);
  });

  it("touches an account that has never been seen", async () => {
    const me = account();
    getDb().prepare("UPDATE accounts SET last_seen_at = NULL WHERE id = ?").run(me.id);
    const { value } = createSession(me.id);
    jar({ [SESSION_COOKIE]: value });

    await currentAccount();
    expect(seenAt(me.id)).not.toBeNull();
  });
});

describe("signing out", () => {
  it("revokes the row as well as clearing the cookie", async () => {
    const me = account();
    const { value } = createSession(me.id);
    const cookieJar = jar({ [SESSION_COOKIE]: value });

    await endSession();

    // Clearing the cookie alone leaves a live row that a *copy* of the cookie
    // could still use — which is exactly the case where somebody signs out
    // because they think it was stolen.
    expect(findAuthSession(getDb(), hashToken(value))?.revokedAt).toBeTruthy();
    expect(cookieJar.deleted).toEqual([SESSION_COOKIE]);
  });

  it("leaves a stolen copy of the cookie useless", async () => {
    const me = account();
    const { value } = createSession(me.id);
    jar({ [SESSION_COOKIE]: value });
    await endSession();

    jar({ [SESSION_COOKIE]: value });
    expect(await currentAccount()).toBeNull();
  });

  it("clears the cookie even when there was no session to revoke", async () => {
    const cookieJar = jar({});
    await expect(endSession()).resolves.toBeUndefined();
    expect(cookieJar.deleted).toEqual([SESSION_COOKIE]);
  });
});

describe("the OAuth state coming back", () => {
  /** Start a sign-in and hand back the nonce Discord would echo. */
  function started(input: Parameters<typeof newOAuthState>[0]) {
    const state = newOAuthState(input);
    jar({ [STATE_COOKIE]: state.cookie.value });
    return state;
  }

  it("returns the secrets the cookie was holding", async () => {
    const state = started({ returnTo: "/roster", codeVerifier: "v-secret", claimCode: "c" });
    expect(await readOAuthState(state.nonce)).toEqual({
      nonce: state.nonce,
      returnTo: "/roster",
      codeVerifier: "v-secret",
      claimCode: "c",
    });
  });

  it("holds the cookie for ten minutes", () => {
    const state = newOAuthState({ returnTo: "/", codeVerifier: "v" });
    // Long enough to sign in to Discord, short enough that a stale tab retries.
    expect(state.cookie.options.maxAge).toBe(10 * 60);
    expect(state.cookie.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
  });

  it.each([
    ["Discord echoed nothing back", null],
    ["Discord echoed the wrong nonce", "not-the-one-we-issued"],
  ])("refuses when %s", async (_label, returned) => {
    started({ returnTo: "/", codeVerifier: "v" });
    expect(await readOAuthState(returned)).toBeNull();
  });

  it("refuses a nonce of a different length without throwing", async () => {
    // `timingSafeEqual` throws outright on mismatched lengths, so the length
    // guard in front of it is load-bearing: without it a crafted callback
    // crashes the route instead of being refused.
    const state = started({ returnTo: "/", codeVerifier: "v" });
    await expect(readOAuthState(state.nonce.slice(0, 8))).resolves.toBeNull();
    await expect(readOAuthState(`${state.nonce}x`)).resolves.toBeNull();
  });

  it("refuses when the browser has no state cookie", async () => {
    const state = newOAuthState({ returnTo: "/", codeVerifier: "v" });
    jar({});
    expect(await readOAuthState(state.nonce)).toBeNull();
  });

  it("refuses when there is no request context", async () => {
    const state = newOAuthState({ returnTo: "/", codeVerifier: "v" });
    noRequest();
    expect(await readOAuthState(state.nonce)).toBeNull();
  });

  it.each([
    ["is not base64 at all", "!!!not base64!!!"],
    ["decodes to something that is not JSON", Buffer.from("hello").toString("base64url")],
    ["is JSON with no nonce", Buffer.from(JSON.stringify({ codeVerifier: "v" })).toString("base64url")],
    [
      "is JSON with no verifier",
      Buffer.from(JSON.stringify({ nonce: "n", returnTo: "/" })).toString("base64url"),
    ],
    ["is JSON that is not an object", Buffer.from("[1,2,3]").toString("base64url")],
  ])("refuses a cookie that %s", async (_label, value) => {
    jar({ [STATE_COOKIE]: value });
    expect(await readOAuthState("n")).toBeNull();
  });
});
