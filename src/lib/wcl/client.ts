/**
 * Minimal Warcraft Logs v2 API client (server-side only).
 *
 * Auth is the OAuth2 client-credentials flow: an LC officer creates a free
 * API client at https://www.warcraftlogs.com/api/clients and puts the pair in
 * .env.local as WCL_CLIENT_ID / WCL_CLIENT_SECRET. The bearer token is cached
 * on globalThis until shortly before expiry. Classic (TBC) reports are served
 * by the main endpoint — report codes are global across game versions.
 */

const TOKEN_URL = process.env.WCL_TOKEN_URL ?? "https://www.warcraftlogs.com/oauth/token";
const API_URL = process.env.WCL_API_URL ?? "https://www.warcraftlogs.com/api/v2/client";

export class WclError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WclError";
  }
}

export function hasWclCredentials(): boolean {
  return Boolean(process.env.WCL_CLIENT_ID && process.env.WCL_CLIENT_SECRET);
}

interface CachedToken {
  token: string;
  /** Unix ms after which we refresh. */
  expiresAt: number;
}

const globalToken = globalThis as unknown as { __projectlcWclToken?: CachedToken };

async function getToken(): Promise<string> {
  const cached = globalToken.__projectlcWclToken;
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const id = process.env.WCL_CLIENT_ID;
  const secret = process.env.WCL_CLIENT_SECRET;
  if (!id || !secret) {
    throw new WclError(
      "Warcraft Logs credentials are not configured — set WCL_CLIENT_ID and WCL_CLIENT_SECRET (see README).",
    );
  }

  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      cache: "no-store",
    });
  } catch (e) {
    throw new WclError(`Could not reach the Warcraft Logs token endpoint: ${e instanceof Error ? e.message : e}`);
  }
  if (!res.ok) {
    throw new WclError(
      res.status === 401
        ? "Warcraft Logs rejected the credentials (401) — check WCL_CLIENT_ID / WCL_CLIENT_SECRET."
        : `Warcraft Logs token request failed with HTTP ${res.status}.`,
    );
  }
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new WclError("Warcraft Logs token response had no access_token.");
  globalToken.__projectlcWclToken = {
    token: body.access_token,
    // Refresh a minute early; fall back to an hour if no expiry is given.
    expiresAt: Date.now() + Math.max(60, (body.expires_in ?? 3600) - 60) * 1000,
  };
  return body.access_token;
}

/**
 * Run one GraphQL query. GraphQL-level errors are surfaced as WclError with
 * the API's own message — those messages are the ground truth when the schema
 * differs from what we expect.
 */
export async function wclQuery<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const token = await getToken();
  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    });
  } catch (e) {
    throw new WclError(`Could not reach the Warcraft Logs API: ${e instanceof Error ? e.message : e}`);
  }
  if (res.status === 401) {
    // Token revoked/expired early — drop the cache so the next call re-auths.
    globalToken.__projectlcWclToken = undefined;
    throw new WclError("Warcraft Logs rejected the API token (401) — try again, or re-check the credentials.");
  }
  if (res.status === 429) {
    throw new WclError("Warcraft Logs rate limit reached (429) — wait a bit and retry.");
  }
  if (!res.ok) throw new WclError(`Warcraft Logs API returned HTTP ${res.status}.`);

  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors && body.errors.length > 0) {
    throw new WclError(`Warcraft Logs API error: ${body.errors.map((e) => e.message).join(" · ")}`);
  }
  if (body.data === undefined || body.data === null) {
    throw new WclError("Warcraft Logs API returned no data.");
  }
  return body.data;
}

/** Extract a report code from a pasted URL or accept a bare code. */
export function extractReportCode(input: string): string | undefined {
  const trimmed = input.trim();
  const fromUrl = trimmed.match(/reports\/(?:[a-z]+-)?([a-zA-Z0-9]{10,32})/);
  if (fromUrl) return fromUrl[1];
  if (/^[a-zA-Z0-9]{10,32}$/.test(trimmed)) return trimmed;
  return undefined;
}
