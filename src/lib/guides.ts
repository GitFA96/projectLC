import {
  CLASS_SPECS,
  TBC_RAIDS,
  TRASH_BOSS,
  WOW_CLASSES,
  bossKey,
  type WowClass,
} from "@/lib/constants/wow";

/**
 * Everything written down about a class or a boss, from either of two authors.
 *
 * Why anyone writes these rather than the app shipping them: the house rule is
 * to name what a source actually says and stay silent otherwise, and this app
 * has no business asserting which flask a Fury warrior should drink. A summary
 * somebody wrote, with the page it came from linked beside it, is both honest
 * about its provenance and correctable when it stops being true — where a
 * pasted copy of somebody else's guide rots without anyone noticing.
 *
 * **Two owners, never merged.** The operator writes a baseline that every guild
 * on the deployment can read as a template; a guild writes its own beside it.
 * Neither overwrites the other, because they are answering different questions:
 * how the fight works is the same everywhere, what we do about it is not. A
 * page shows both and says which is which.
 *
 * `section: ""` is the subject itself — what every spec of a class shares, or
 * what applies to a whole raid rather than one boss.
 */
export interface Guide {
  /** 'class' or 'raid'. */
  kind: GuideKind;
  /** 'Warrior', 'Black Temple'. */
  subject: string;
  /** '' for the subject itself, else 'Fury' or 'Supremus'. */
  section: string;
  /** `OPERATOR_OWNER`, or the guild's own id. */
  owner: string;
  /** The summary, as markdown. */
  body: string;
  /** URLs the summary was drawn from. */
  sources: string[];
  author?: string;
  updatedAt: string;
}

export type GuideKind = "class" | "raid";

/**
 * The shared baseline's owner.
 *
 * A literal rather than a guild id, and reserved: guild ids are generated, so
 * nothing can claim it by accident. Anything that is not this string is a guild.
 */
export const OPERATOR_OWNER = "operator";

export const isOperatorGuide = (guide: Guide): boolean => guide.owner === OPERATOR_OWNER;

/** Slug for a class in a URL — lowercase, no spaces. */
export const classSlug = (wowClass: string) => wowClass.toLowerCase().replace(/\s+/g, "-");

export function classFromSlug(slug: string): WowClass | undefined {
  return WOW_CLASSES.find((c) => classSlug(c) === slug.toLowerCase());
}

/** Slug for a zone or a boss. Punctuation drops out, so apostrophes can't break a URL. */
export const zoneSlug = (zone: string) => zone.toLowerCase().replace(/[^a-z0-9]+/g, "-");

export function zoneFromSlug(slug: string): string | undefined {
  return TBC_RAIDS.find((r) => zoneSlug(r.name) === slug.toLowerCase())?.name;
}

/**
 * Bosses a raid guide can cover: trash first, then the raid's own order.
 *
 * The same spine the loot plan uses, and for the same reason — it is the order
 * the raid meets them, which is the order anybody reads about them in.
 */
export function raidSections(zone: string): string[] {
  const raid = TBC_RAIDS.find((r) => r.name === zone);
  return raid ? [TRASH_BOSS, ...raid.bosses] : [];
}

export function bossFromSlug(zone: string, slug: string): string | undefined {
  return raidSections(zone).find((b) => zoneSlug(b) === slug.toLowerCase());
}

/** Every guide slot a class has: the class itself, then each of its specs. */
export function guideSlots(wowClass: WowClass): { section: string; label: string }[] {
  return [
    { section: "", label: "All specs" },
    ...CLASS_SPECS[wowClass].map((spec) => ({ section: spec, label: spec })),
  ];
}

/**
 * The two guides that can exist for one slot.
 *
 * Deliberately not a single "effective" guide. Collapsing them would have to
 * pick a winner, and there is no winner to pick: the baseline explains the
 * fight and the guild's own says what they do about it. A reader needs both,
 * labelled.
 */
export interface GuidePair {
  /** The shared baseline, when an operator has written one. */
  template?: Guide;
  /** This guild's own, when they have written one. */
  own?: Guide;
}

export function findGuides(
  guides: Guide[],
  kind: GuideKind,
  subject: string,
  section: string,
  guildId: string,
): GuidePair {
  // Boss names arrive from several sources and are compared the way every other
  // boss comparison in this app is — see `bossKey`. Class sections are exact.
  const same = (a: string, b: string) =>
    kind === "raid" ? bossKey(a) === bossKey(b) : a === b;
  const rows = guides.filter(
    (g) => g.kind === kind && g.subject === subject && same(g.section, section),
  );
  return {
    template: rows.find((g) => g.owner === OPERATOR_OWNER),
    own: rows.find((g) => g.owner === guildId),
  };
}

/** How much of a subject's guide exists yet — drives an index's progress hint. */
export function guideCoverage(
  guides: Guide[],
  kind: GuideKind,
  subject: string,
  sections: string[],
  guildId: string,
): { written: number; total: number } {
  const written = sections.filter((section) => {
    const pair = findGuides(guides, kind, subject, section, guildId);
    return pair.template !== undefined || pair.own !== undefined;
  }).length;
  return { written, total: sections.length };
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
