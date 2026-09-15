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
 * Warcraft DB exposes the enchantment table itself, one page per id. That's the
 * missing dictionary — the same role the item resolver plays for item ids, with
 * the same rules: one request per unknown id ever, capped per run, never during
 * a render, and an id that can't be resolved simply stays an id rather than
 * becoming a guess.
 *
 * **This source has moved once already.** It was `api.wowclassicdb.com`, a JSON
 * API, until that host started answering 404 for every path including its own
 * root — at which point every lookup failed and the import card went on
 * reporting the ids as "not in the enchantment table", which is a claim about
 * the table rather than about the host being gone. The lesson is in
 * `listRefusedEnchantIds`: a queue that cannot say what it already asked cannot
 * tell those two apart, and the officer absorbs the difference.
 */

/** The enchantment page, on the site `wowclassicdb.com` now redirects to. */
const PAGE_URL = (enchantId: number) =>
  `https://tbc.warcraftdb.com/data/enchantment/${enchantId}`;

/** One enchant id resolved to the effect text an item tooltip shows. */
export interface ResolvedEnchant {
  id: number;
  name: string;
}

/**
 * The enchant's name, from the page's own structured description.
 *
 * The page is HTML, but it carries a schema.org block naming the entity it is
 * about and — the part that matters — the id it is about:
 *
 *     {"@type": "Thing", "name": "+20 Spirit", "identifier": "2567", …}
 *
 * **The identifier has to match.** Reading the `<title>` or the breadcrumb
 * would be a line shorter and would happily name an enchant off a redirect, a
 * search page or a soft 404. A name is written into the cache forever and shows
 * on a raider's gear panel, so the only acceptable failure here is no name.
 *
 * If the site ever stops emitting that block this returns nothing for every id,
 * which is the same shape of outage as the host moving — visible as a standing
 * list of refusals rather than as a count that never goes down.
 */
export function parseEnchantName(enchantId: number, html: string): string | undefined {
  const blocks = html.matchAll(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const [, block] of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block);
    } catch {
      continue;
    }
    const graph =
      typeof parsed === "object" && parsed !== null && "@graph" in parsed
        ? (parsed as { "@graph": unknown })["@graph"]
        : parsed;
    for (const node of Array.isArray(graph) ? graph : [graph]) {
      if (typeof node !== "object" || node === null) continue;
      const { identifier, name } = node as { identifier?: unknown; name?: unknown };
      if (identifier === undefined || String(identifier) !== String(enchantId)) continue;
      if (typeof name !== "string" || !name.trim()) continue;
      return name.trim();
    }
  }
  return undefined;
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
    const res = await fetch(PAGE_URL(enchantId), {
      signal: controller.signal,
      headers: { "User-Agent": "projectlc-guild-tracker", Accept: "text/html" },
      cache: "no-store",
    });
    if (res.status === 429 || res.status === 403) return { kind: "throttled" };
    if (!res.ok) return { kind: "unknown" };
    const name = parseEnchantName(enchantId, await res.text());
    return name ? { kind: "enchant", enchant: { id: enchantId, name } } : { kind: "unknown" };
  } catch {
    return { kind: "unknown" };
  } finally {
    clearTimeout(timer);
  }
}

export interface ResolveEnchantsResult {
  resolved: ResolvedEnchant[];
  /** Ids the database had nothing for — recorded as asked, so never retried in a loop. */
  failed: number[];
  /** True when the run stopped early because requests started being refused. */
  throttled: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Look ids up one at a time with a short pause between them — a backfill is a
 * trickle, not a burst. `limit` caps one run; the rest is picked up next press.
 *
 * A full page is a heavier response than the JSON fragment this used to ask
 * for, so the pause is longer than the item resolver's.
 */
export async function resolveEnchantNames(
  enchantIds: number[],
  opts: { limit?: number; pauseMs?: number; timeoutMs?: number } = {},
): Promise<ResolveEnchantsResult> {
  const { limit = 60, pauseMs = 300, timeoutMs = 8000 } = opts;
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
