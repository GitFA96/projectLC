import itemsJson from "@/data/seed/items.json";
import type { ItemRef } from "@/components/item-link";
import type { Quality } from "@/lib/types";

/**
 * Item cache for client components (import previews) that can't reach the
 * server repo. The seed item list is small enough to ship to the browser.
 */
const byId = new Map<number, { name: string; quality: Quality; icon: string }>(
  (itemsJson as { id: number; name: string; quality: Quality; icon: string }[]).map((i) => [
    i.id,
    { name: i.name, quality: i.quality, icon: i.icon },
  ]),
);

export function resolveItemRef(itemId: number, fallbackName?: string): ItemRef {
  const cached = byId.get(itemId);
  return {
    itemId,
    name: cached?.name ?? fallbackName,
    quality: cached?.quality,
    icon: cached?.icon,
  };
}

export function isKnownItem(itemId: number): boolean {
  return byId.has(itemId);
}
