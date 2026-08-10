import { CLASS_SPECS, WOW_CLASSES, type WowClass } from "@/lib/constants/wow";

/**
 * The guild's own class and spec guides.
 *
 * Why the guild writes these rather than the app shipping them: the house rule
 * is to name what a source actually says and stay silent otherwise, and this
 * app has no business asserting which flask a Fury warrior should drink. A
 * summary an officer wrote, with the page it came from linked beside it, is
 * both honest about its provenance and correctable when it stops being true —
 * where a pasted copy of somebody else's guide rots without anyone noticing.
 *
 * A guide is keyed by class and spec; `spec: ""` is the class-level one, for
 * what every spec of that class shares.
 */
export interface ClassGuide {
  wowClass: string;
  /** Empty string for the class-level guide. */
  spec: string;
  /** The officers' summary, as markdown. */
  body: string;
  /** URLs the summary was drawn from. */
  sources: string[];
  author?: string;
  updatedAt: string;
}

/** Slug for a class in a URL — lowercase, no spaces. */
export const classSlug = (wowClass: string) => wowClass.toLowerCase().replace(/\s+/g, "-");

export function classFromSlug(slug: string): WowClass | undefined {
  return WOW_CLASSES.find((c) => classSlug(c) === slug.toLowerCase());
}

/** Every guide slot a class has: the class itself, then each of its specs. */
export function guideSlots(wowClass: WowClass): { spec: string; label: string }[] {
  return [
    { spec: "", label: "All specs" },
    ...CLASS_SPECS[wowClass].map((spec) => ({ spec, label: spec })),
  ];
}

export function findGuide(
  guides: ClassGuide[],
  wowClass: string,
  spec: string,
): ClassGuide | undefined {
  return guides.find((g) => g.wowClass === wowClass && g.spec === spec);
}

/** How much of a class's guide exists yet — drives the index's progress hint. */
export function guideCoverage(
  guides: ClassGuide[],
  wowClass: WowClass,
): { written: number; total: number } {
  const slots = guideSlots(wowClass);
  return {
    written: slots.filter((s) => findGuide(guides, wowClass, s.spec) !== undefined).length,
    total: slots.length,
  };
}

/**
 * A source is shown as a link only when it is one. Officers paste URLs, but
 * they also paste "Bloodmallet, March" — that should still be readable rather
 * than rendered as a broken link, and it must never become an href.
 */
export function sourceHref(source: string): string | undefined {
  try {
    const url = new URL(source);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
