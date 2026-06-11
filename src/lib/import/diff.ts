import { SLOT_FAMILIES, SLOT_LABELS, SLOT_META, type SlotId } from "@/lib/constants/wow";
import type { SlotItem } from "@/lib/types";

/**
 * What changes if this import replaces that set? Shown in the confirm step of
 * the wishlist/current-gear update flow. Rings and trinkets are compared as
 * family multisets (same items in swapped slots is NOT a change).
 */

export interface SlotDiffRow {
  /** "Head", "Rings", "Trinkets", … */
  label: string;
  before: string[];
  after: string[];
}

interface FamilyBucket {
  label: string;
  order: number;
  before: SlotItem[];
  after: SlotItem[];
}

function familyOf(slot: SlotId): { key: string; label: string } {
  const family = SLOT_FAMILIES[slot];
  if (family === "ring") return { key: "ring", label: "Rings" };
  if (family === "trinket") return { key: "trinket", label: "Trinkets" };
  return { key: slot, label: SLOT_LABELS[slot] };
}

const SLOT_ORDER = new Map(SLOT_META.map((s, i) => [s.id, i]));

export function diffGearSetSlots(before: SlotItem[], after: SlotItem[]): SlotDiffRow[] {
  const buckets = new Map<string, FamilyBucket>();
  const bucketFor = (slot: SlotId): FamilyBucket => {
    const { key, label } = familyOf(slot);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { label, order: SLOT_ORDER.get(slot) ?? 99, before: [], after: [] };
      buckets.set(key, bucket);
    }
    return bucket;
  };
  for (const item of before) bucketFor(item.slot).before.push(item);
  for (const item of after) bucketFor(item.slot).after.push(item);

  const rows: SlotDiffRow[] = [];
  for (const bucket of [...buckets.values()].sort((a, b) => a.order - b.order)) {
    const beforeIds = bucket.before.map((s) => s.itemId).sort((a, b) => a - b);
    const afterIds = bucket.after.map((s) => s.itemId).sort((a, b) => a - b);
    if (beforeIds.length === afterIds.length && beforeIds.every((id, i) => id === afterIds[i])) continue;
    rows.push({
      label: bucket.label,
      before: bucket.before.map((s) => s.itemName),
      after: bucket.after.map((s) => s.itemName),
    });
  }
  return rows;
}
