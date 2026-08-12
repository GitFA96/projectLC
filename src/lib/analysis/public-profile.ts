import type { Faction, Role, WowClass } from "@/lib/constants/wow";
import { GUILD_VISIBILITIES } from "@/lib/import/schemas";
import type { GuildVisibility } from "@/lib/types";

import { compareText } from "@/lib/sort";

/**
 * What a guild shows the world.
 *
 * **This module can only leak what its input type names.** That is the whole
 * design, and it is why the outsider view is composed separately rather than
 * being the member page with fields blanked (§6): a blanked page publishes the
 * next field somebody adds until they remember it shouldn't, silently, and the
 * guild finds out from a rival. Here, adding a column to `Character` reaches
 * this page only if somebody widens `PublicCharacter` *and* the mapping that
 * fills it — two deliberate edits, in a file that says what it is for.
 *
 * The line, decided 2026-08-11: **the public face may show what Warcraft Logs
 * already publishes about this guild, and may never show the guild's own
 * judgements.** A named roster is not a secret — it is on the guild's WCL page
 * with classes, specs and every parse. What is nowhere else is the council's
 * reasoning, so that is the thing worth closing: the ledger, the priority
 * sheet, standing, attendance, preparation, comments, exemptions, the loot
 * plan. None of them are reachable from here, by construction.
 *
 * `status` is deliberately **not** public either, though it sits on the same
 * row as the name and the class. Main, alt, trial and pug are the guild's
 * opinion of a person, not a fact Warcraft Logs publishes, and "who is on
 * trial" is exactly the kind of thing a guild would be dismayed to find on its
 * own public page.
 */

export type { GuildVisibility };

/**
 * The order they are offered in — each is the one before it plus more.
 *
 * Derived from the zod gate rather than repeated: the two lists sat in two
 * files saying the same three words, which is the shape where a fourth preset
 * gets added to one of them. **The order in `GUILD_VISIBILITIES` is
 * load-bearing here** — `z.enum` does not care, this ladder does.
 */
export const VISIBILITY_LADDER: readonly GuildVisibility[] = GUILD_VISIBILITIES;

export const VISIBILITY_META: Record<GuildVisibility, { label: string; blurb: string }> = {
  private: {
    label: "Private",
    blurb: "Only that the guild exists. Nobody outside sees the roster or when you raid.",
  },
  recruiting: {
    label: "Recruiting",
    blurb: "Adds the roster by name, class and spec, and which tier you're raiding — the WCL-shaped face, for people deciding whether to apply.",
  },
  open: {
    label: "Open",
    blurb: "Adds which raids you logged and when. Still nothing the council decided.",
  },
};

export function isGuildVisibility(value: unknown): value is GuildVisibility {
  return typeof value === "string" && (VISIBILITY_LADDER as readonly string[]).includes(value);
}

/** The default a deployment starts on, and upgrades into. Deny by default. */
export const DEFAULT_VISIBILITY: GuildVisibility = "private";

/** Exactly the character fields that may ever be public. Not `status`. */
export interface PublicCharacter {
  name: string;
  wowClass: WowClass;
  spec: string;
  role: Role;
}

export interface PublicRaidNight {
  date: string;
  zones: string[];
}

export interface PublicProfileInput {
  guild: { name: string; realm: string; faction: Faction; activePhase: number };
  roster: readonly PublicCharacter[];
  raidNights: readonly PublicRaidNight[];
  visibility: GuildVisibility;
}

/**
 * `null` means "this guild does not publish that", which is a different thing
 * from an empty list — a guild with no logged raids and a guild that keeps them
 * to itself should not read the same to a stranger.
 */
export interface PublicProfile {
  visibility: GuildVisibility;
  name: string;
  realm: string;
  faction: Faction;
  activePhase: number | null;
  roster: PublicCharacter[] | null;
  rosterSize: number | null;
  raidNights: PublicRaidNight[] | null;
}

const byName = new Intl.Collator("en", { sensitivity: "base", numeric: true }).compare;

/** How recent a raid night has to be to appear. A year of history is not a face. */
const RECENT_NIGHTS = 12;

export function buildPublicProfile(input: PublicProfileInput): PublicProfile {
  const { visibility } = input;
  // Cumulative, not exclusive: each preset is the one below it plus more. A
  // guild moving up should never lose something it was already showing.
  const recruiting = visibility === "recruiting" || visibility === "open";
  const open = visibility === "open";

  return {
    visibility,
    // Name, realm and faction at every preset, including Private. A guild that
    // publishes nothing still has to be identifiable, or the page is a 404 with
    // extra steps and an invite link lands nowhere recognisable.
    name: input.guild.name,
    realm: input.guild.realm,
    faction: input.guild.faction,
    activePhase: recruiting ? input.guild.activePhase : null,
    roster: recruiting ? [...input.roster].sort((a, b) => byName(a.name, b.name)) : null,
    rosterSize: recruiting ? input.roster.length : null,
    raidNights: open
      ? [...input.raidNights].sort((a, b) => compareText(b.date, a.date)).slice(0, RECENT_NIGHTS)
      : null,
  };
}
