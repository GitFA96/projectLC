import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  authorizeUrl,
  createPkceVerifier,
  discordConfigured,
  pkceChallenge,
  redirectUri,
} from "./discord";
import { newOAuthState, safeReturnTo } from "./session";

const ENV = ["DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "DISCORD_REDIRECT_URI"] as const;
const original = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const key of ENV) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

function configure() {
  process.env.DISCORD_CLIENT_ID = "client-123";
  process.env.DISCORD_CLIENT_SECRET = "secret-456";
  process.env.DISCORD_REDIRECT_URI = "http://localhost:3000/api/auth/discord/callback";
}

describe("open redirect", () => {
  it("keeps a redirect target on this site", () => {
    expect(safeReturnTo("/roster")).toBe("/roster");
    expect(safeReturnTo("/loot?phase=3")).toBe("/loot?phase=3");
  });

  it("refuses everything that leaves the site", () => {
    // The classic one: a browser reads `//host` as absolute, so "starts with a
    // slash" is not a sufficient check — and an OAuth callback is exactly where
    // that gets found.
    expect(safeReturnTo("//evil.example/steal")).toBe("/");
    expect(safeReturnTo("https://evil.example")).toBe("/");
    expect(safeReturnTo("http://localhost:3000/roster")).toBe("/");
    // Some browsers normalise a backslash to a slash before parsing.
    expect(safeReturnTo("/\\evil.example")).toBe("/");
    expect(safeReturnTo("javascript:alert(1)")).toBe("/");
  });

  it("falls back when there is nothing to go on", () => {
    expect(safeReturnTo(null)).toBe("/");
    expect(safeReturnTo(undefined)).toBe("/");
    expect(safeReturnTo("")).toBe("/");
    expect(safeReturnTo(null, "/admin")).toBe("/admin");
  });
});

describe("PKCE", () => {
  it("derives the challenge as base64url(sha256(verifier)), per S256", () => {
    const verifier = "a-known-verifier";
    const expected = createHash("sha256").update(verifier).digest("base64url");
    expect(pkceChallenge(verifier)).toBe(expected);
    // base64url: no padding, no + or /, or Discord rejects the challenge.
    expect(pkceChallenge(verifier)).not.toMatch(/[+/=]/);
  });

  it("makes a fresh verifier every time", () => {
    const seen = new Set(Array.from({ length: 50 }, () => createPkceVerifier()));
    expect(seen.size).toBe(50);
    expect(createPkceVerifier().length).toBeGreaterThanOrEqual(43);
  });
});

describe("the authorize URL", () => {
  it("asks for identify only", () => {
    configure();
    const url = new URL(authorizeUrl("state-1", "verifier-1"));
    // Not `email` (we store none) and not `guilds` (joining is an officer's
    // judgement, never inferred from a Discord server).
    expect(url.searchParams.get("scope")).toBe("identify");
  });

  it("carries the state and the S256 challenge, never the verifier", () => {
    configure();
    const url = new URL(authorizeUrl("state-1", "verifier-1"));
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(pkceChallenge("verifier-1"));
    expect(url.toString()).not.toContain("verifier-1");
  });

  it("does not force the consent screen on every sign-in", () => {
    configure();
    // `state` is what stops a login the user did not start; re-consenting every
    // time is friction with no matching return.
    expect(new URL(authorizeUrl("s", "v")).searchParams.get("prompt")).toBeNull();
  });

  /*
   * The composition test, and the one that matters.
   *
   * The isolated test above passed while the app was leaking: `newOAuthState`
   * encoded the verifier and the claim code INTO the state, and the start route
   * put that state in the URL. Testing `authorizeUrl` with a handmade state
   * string could never see it. Build the state the way the app does.
   */
  it("keeps every secret out of the URL when the state is the one the app builds", () => {
    configure();
    const verifier = "verifier-that-must-not-travel";
    const claimCode = "claim-code-that-must-not-travel";
    // An invite code is a key to a character's identity in a guild, so it is
    // held to exactly the same standard as the other two.
    const inviteCode = "invite-code-that-must-not-travel";
    const state = newOAuthState({ returnTo: "/roster", claimCode, inviteCode, codeVerifier: verifier });

    const url = authorizeUrl(state.nonce, verifier);

    expect(url).not.toContain(verifier);
    expect(url).not.toContain(claimCode);
    expect(url).not.toContain(inviteCode);
    expect(url).not.toContain("/roster");
    // Everything secret lives in the cookie instead.
    const cookie = Buffer.from(state.cookie.value, "base64url").toString("utf8");
    expect(cookie).toContain(verifier);
    expect(cookie).toContain(claimCode);
    expect(cookie).toContain(inviteCode);
    expect(state.cookie.options.httpOnly).toBe(true);
  });

  it("gives Discord an opaque nonce that reveals nothing when decoded", () => {
    const state = newOAuthState({ returnTo: "/loot", codeVerifier: "v" });
    // A base64url-decodable nonce that happened to contain JSON would be the
    // same leak wearing a different coat.
    expect(() => JSON.parse(Buffer.from(state.nonce, "base64url").toString("utf8"))).toThrow();
    expect(state.nonce).not.toContain("/loot");
  });

  it("never leaks the client secret into the browser-visible URL", () => {
    configure();
    expect(authorizeUrl("s", "v")).not.toContain("secret-456");
  });

  it("refuses to build one when Discord is not configured", () => {
    for (const key of ENV) delete process.env[key];
    expect(discordConfigured()).toBe(false);
    expect(() => authorizeUrl("s", "v")).toThrow(/not configured/i);
  });
});

describe("configuration", () => {
  it("needs all three values, not some of them", () => {
    for (const key of ENV) delete process.env[key];
    expect(discordConfigured()).toBe(false);
    process.env.DISCORD_CLIENT_ID = "client-123";
    expect(discordConfigured()).toBe(false);
    process.env.DISCORD_CLIENT_SECRET = "secret-456";
    expect(discordConfigured()).toBe(false);
    process.env.DISCORD_REDIRECT_URI = "http://localhost:3000/api/auth/discord/callback";
    expect(discordConfigured()).toBe(true);
  });

  it("treats whitespace-only config as absent, which is what a blank .env line gives you", () => {
    configure();
    process.env.DISCORD_CLIENT_SECRET = "   ";
    expect(discordConfigured()).toBe(false);
  });

  it("reads the redirect from env rather than deriving it from the request", () => {
    configure();
    // Discord matches this as an exact string, so it has to be the registered
    // one — localhost and production differ by config, not by code.
    expect(redirectUri()).toBe("http://localhost:3000/api/auth/discord/callback");
  });
});
