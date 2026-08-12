import type { Quality, SlotId } from "@/lib/types";

import { compareText } from "@/lib/sort";

/** Slim item entry shipped to the nav for instant client-side lookup. */
export interface QuickSearchItem {
  itemId: number;
  name: string;
  quality?: Quality;
  icon?: string;
  slot?: SlotId | null;
  wisherCount: number;
  openCount: number;
  awardCount: number;
}

/**
 * Rank items for the quick-search dropdown. Matching is token-AND
 * (every word of the query must appear); ranking prefers name-start
 * matches, then word-start matches, then open demand — the council
 * usually wants the contested item, not the alphabetical one.
 */
export function rankItemMatches(
  items: QuickSearchItem[],
  query: string,
  limit = 8,
): QuickSearchItem[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const tokens = q.split(/\s+/);

  const scored: { item: QuickSearchItem; score: number }[] = [];
  for (const item of items) {
    const name = item.name.toLowerCase();
    if (!tokens.every((t) => name.includes(t))) continue;
    let score = 2;
    if (name.startsWith(q)) score = 0;
    else if (name.split(/[\s,'-]+/).some((word) => word.startsWith(tokens[0]))) score = 1;
    scored.push({ item, score });
  }

  return scored
    .sort(
      (a, b) =>
        a.score - b.score ||
        b.item.openCount - a.item.openCount ||
        b.item.wisherCount - a.item.wisherCount ||
        b.item.awardCount - a.item.awardCount ||
        compareText(a.item.name, b.item.name),
    )
    .slice(0, limit)
    .map((s) => s.item);
}
