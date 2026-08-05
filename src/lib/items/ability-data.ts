/**
 * Naming the ability ids a simulation reports.
 *
 * Warcraft Logs names an ability only if somebody actually cast it, so a sim
 * pressing something the guild never does — Execute on a boss they burn down,
 * a sapper charge nobody throws — leaves a bare id in the comparison. Those are
 * exactly the rows worth reading, which makes the id the worst possible label.
 *
 * The id alone is NOT enough to look up. wowsims reports two kinds of action —
 * `{spellId}` and `{itemId}` — and the two id spaces overlap: 23827 is Super
 * Sapper Charge as an item and Master Demonologist as a spell, and 10646
 * (Goblin Sapper Charge) is an item with no spell of that id at all. Asking the
 * spell endpoint for every id therefore produces a confident wrong name for
 * some and nothing for others. So a lookup carries its kind, end to end.
 *
 * Same shape as the item cache otherwise: resolve once from Wowhead, store
 * forever, and show the id rather than invent a name when the lookup fails.
 */

export type AbilityKind = "spell" | "item";

/** What to look up: an id is meaningless without knowing which space it's in. */
export interface AbilityRef {
  kind: AbilityKind;
  id: number;
}

export interface AbilityInfo extends AbilityRef {
  name: string;
  icon?: string;
  /** One-line summary of what it does, stripped out of the tooltip. */
  description?: string;
  /**
   * For an item: the spell its Use effect casts.
   *
   * The two sides of the comparison record the same click differently — the
   * sim reports item 10646, the combat log records spell 13241 — so without
   * this the same sapper charge appears twice, once as "sim only" and once as
   * "pull only", and a raider gets told off for not using something they used.
   */
  useSpellId?: number;
}

const TOOLTIP_URL = (ref: AbilityRef) =>
  `https://nether.wowhead.com/tbc/tooltip/${ref.kind}/${ref.id}?locale=0`;

export const wowheadUrl = (ref: AbilityRef) => `https://www.wowhead.com/tbc/${ref.kind}=${ref.id}`;

/** Cache/dictionary key — an id on its own would collide across the two spaces. */
export const refKey = (ref: AbilityRef) => `${ref.kind}:${ref.id}`;

/** How a ref reads when nothing can name it: "Spell 25236", "Item 10646". */
export const refLabel = (ref: AbilityRef) =>
  `${ref.kind === "item" ? "Item" : "Spell"} ${ref.id}`;

/** Parse "spell:25236" back into a ref; anything else is undefined. */
export function parseRefKey(key: string): AbilityRef | undefined {
  const m = /^(spell|item):(\d+)$/.exec(key);
  return m ? { kind: m[1] as AbilityKind, id: Number(m[2]) } : undefined;
}

const stripMarkup = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const clip = (text: string) => (text.length > 240 ? `${text.slice(0, 237)}…` : text);

/**
 * Pull a readable sentence out of Wowhead's tooltip HTML.
 *
 * The two kinds need opposite treatment, which is why kind travels this far
 * down. A SPELL keeps its effect in a div below the cost/range/requirement
 * tables. An ITEM tooltip is entirely tables — the same treatment leaves
 * nothing — and the line that matters is the "Use:" or "Equip:" clause, with
 * the stat block and vendor price around it as noise.
 */
export function describeFromTooltip(tooltip: string, kind: AbilityKind = "spell"): string | undefined {
  if (kind === "item") {
    const text = stripMarkup(tooltip);
    const effect = /((?:Use|Equip|Chance on hit):[\s\S]*?)(?:Max Stack|Sell Price|Item Level|$)/.exec(text);
    const out = (effect?.[1] ?? text).trim();
    return out ? clip(out) : undefined;
  }
  /*
   * A spell's effect sits in its own `<div class="q">`, in a second table below
   * the cost/range/requirement block. Stripping tables — which is what an item
   * tooltip needs — throws exactly that away and leaves "Instant cast Requires
   * Warrior Requires level 70", which describes nothing. Take the divs, and the
   * longest one: the first is often just a tag ("Talent", "Item Effect").
   */
  const divs = [...tooltip.matchAll(/<div class="q[^"]*">([\s\S]*?)<\/div>/g)]
    .map((m) => stripMarkup(m[1]))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (divs[0]) return clip(divs[0]);
  // Table rows hold cost/range/cast time — useful in game, noise in a list.
  const text = stripMarkup(tooltip.replace(/<table[\s\S]*?<\/table>/g, " "));
  return text ? clip(text) : undefined;
}

/**
 * The spell an item's Use effect casts, from the link Wowhead puts inside it:
 * `<a href="/tbc/spell=13241/goblin-sapper-charge">`. Taken from the markup
 * rather than a table of our own, because a hand-kept item→spell list is
 * exactly the kind of inventory that rots without anyone noticing.
 */
export function itemUseSpellId(tooltip: string): number | undefined {
  const use = /(?:Use|Chance on hit):[\s\S]{0,400}?\/tbc\/spell=(\d+)/.exec(tooltip);
  return use ? Number(use[1]) : undefined;
}

export function parseWowheadTooltip(ref: AbilityRef, body: string): AbilityInfo | undefined {
  let parsed: { name?: string; icon?: string; tooltip?: string; error?: string };
  try {
    parsed = JSON.parse(body) as typeof parsed;
  } catch {
    return undefined;
  }
  const name = parsed.name?.trim();
  if (!name) return undefined;
  const useSpellId =
    ref.kind === "item" && parsed.tooltip ? itemUseSpellId(parsed.tooltip) : undefined;
  return {
    ...ref,
    name,
    icon: parsed.icon?.trim() || undefined,
    description: parsed.tooltip ? describeFromTooltip(parsed.tooltip, ref.kind) : undefined,
    ...(useSpellId ? { useSpellId } : {}),
  };
}

type FetchOutcome =
  | { kind: "found"; info: AbilityInfo }
  | { kind: "unknown" }
  /** Wowhead is turning us away (429/403) — stop asking for now. */
  | { kind: "throttled" };

async function fetchOne(ref: AbilityRef, timeoutMs: number): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(TOOLTIP_URL(ref), {
      signal: controller.signal,
      headers: { "User-Agent": "projectlc-guild-tracker" },
      cache: "no-store",
    });
    if (res.status === 429 || res.status === 403) return { kind: "throttled" };
    if (!res.ok) return { kind: "unknown" };
    const info = parseWowheadTooltip(ref, await res.text());
    return info ? { kind: "found", info } : { kind: "unknown" };
  } catch {
    return { kind: "unknown" };
  } finally {
    clearTimeout(timer);
  }
}

export interface ResolveAbilitiesResult {
  resolved: AbilityInfo[];
  /** Refs Wowhead had nothing for — left unresolved rather than retried in a loop. */
  failed: AbilityRef[];
  /** True when the run stopped early because Wowhead started refusing requests. */
  throttled: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One request at a time with a pause between them, capped per run — the same
 * trickle the item resolver uses, and for the same reason: a burst is what gets
 * a client turned away. A refusal ends the run without marking those refs as
 * missing, because the ability is fine and a later press will work.
 */
export async function resolveAbilitiesFromWowhead(
  refs: AbilityRef[],
  opts: { limit?: number; pauseMs?: number; timeoutMs?: number } = {},
): Promise<ResolveAbilitiesResult> {
  const { limit = 40, pauseMs = 250, timeoutMs = 8000 } = opts;
  const seen = new Set<string>();
  const queue = refs
    .filter((r) => r.id > 0 && !seen.has(refKey(r)) && (seen.add(refKey(r)), true))
    .slice(0, limit);
  const resolved: AbilityInfo[] = [];
  const failed: AbilityRef[] = [];

  for (const [index, ref] of queue.entries()) {
    if (index > 0) await sleep(pauseMs);
    const outcome = await fetchOne(ref, timeoutMs);
    if (outcome.kind === "throttled") return { resolved, failed, throttled: true };
    if (outcome.kind === "found") resolved.push(outcome.info);
    else failed.push(ref);
  }
  return { resolved, failed, throttled: false };
}
