import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

/**
 * Do two spec strings name the same spec? Specs are free text typed by hand in
 * the roster and reported by Warcraft Logs, so "Beast Mastery" and
 * "beastmastery" have to compare equal.
 */
export function sameSpec(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return a.replace(/\s/g, "").toLowerCase() === b.replace(/\s/g, "").toLowerCase();
}

/** "spellHasteRating" -> "Spell Haste Rating" (fallback for stat keys without metadata) */
export function prettifyKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
