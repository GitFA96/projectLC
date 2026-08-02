/**
 * Naming the enchant ids Warcraft Logs reports.
 *
 * A permanent enchant arrives from WCL as a bare SpellItemEnchantment id
 * (2661, 1593…). Wowhead has no page for one — /tbc/enchantment=2661 is a 404,
 * and its tooltip endpoint applies the enchant in the browser, not on the
 * server — so the app has always fallen back to the guild's own SixtyUpgrades
 * imports, which list each slot's enchant with an id AND a name.
 *
 * That covers what the guild happens to have listed and nothing else: on a
 * real roster roughly a fifth of worn enchants stay unnamed, including common
 * ones nobody puts on a wishlist (scopes, the +24 attack power a hunter's
 * gloves carry, resistance enchants worn for one fight).
 *
 * The Classic DB project exposes the enchantment table itself, one small JSON
 * object per id. That's the missing dictionary — the same role the item
 * resolver plays for item ids, with the same rules: one request per unknown id
 * ever, capped per run, never during a render, and an id that can't be
 * resolved simply stays an id rather than becoming a guess.
 */

const API_URL = (enchantId: number) => `https://api.wowclassicdb.com/tbc/enchantment/${enchantId}`;

/** One enchant id resolved to the effect text an item tooltip shows. */
export interface ResolvedEnchant {
  id: number;
  name: string;
}

type FetchOutcome =
  | { kind: "enchant"; enchant: ResolvedEnchant }
  /** Answered, but there's nothing usable for that id. */
  | { kind: "unknown" }
  /** Being turned away (429/403) — stop asking for now. */
  | { kind: "throttled" };

async function fetchOne(enchantId: number, timeoutMs: number): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(API_URL(enchantId), {
      signal: controller.signal,
      headers: { "User-Agent": "projectlc-guild-tracker", Accept: "application/json" },
      cache: "no-store",
    });
    if (res.status === 429 || res.status === 403) return { kind: "throttled" };
    if (!res.ok) return { kind: "unknown" };
    const body: unknown = await res.json();
    const name =
      typeof body === "object" && body !== null && "name" in body && typeof body.name === "string"
        ? body.name.trim()
        : "";
    return name ? { kind: "enchant", enchant: { id: enchantId, name } } : { kind: "unknown" };
  } catch {
    return { kind: "unknown" };
  } finally {
    clearTimeout(timer);
  }
}

export interface ResolveEnchantsResult {
  resolved: ResolvedEnchant[];
  /** Ids the database had nothing for — they stay as ids, not retried in a loop. */
  failed: number[];
  /** True when the run stopped early because requests started being refused. */
  throttled: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Look ids up one at a time with a short pause between them — a backfill is a
 * trickle, not a burst. `limit` caps one run; the rest is picked up next press.
 */
export async function resolveEnchantNames(
  enchantIds: number[],
  opts: { limit?: number; pauseMs?: number; timeoutMs?: number } = {},
): Promise<ResolveEnchantsResult> {
  const { limit = 60, pauseMs = 150, timeoutMs = 8000 } = opts;
  const queue = [...new Set(enchantIds)].filter((id) => Number.isInteger(id) && id > 0).slice(0, limit);
  const resolved: ResolvedEnchant[] = [];
  const failed: number[] = [];

  for (const [index, enchantId] of queue.entries()) {
    if (index > 0) await sleep(pauseMs);
    const outcome = await fetchOne(enchantId, timeoutMs);
    if (outcome.kind === "throttled") return { resolved, failed, throttled: true };
    if (outcome.kind === "enchant") resolved.push(outcome.enchant);
    else failed.push(enchantId);
  }
  return { resolved, failed, throttled: false };
}
