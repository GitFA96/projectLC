/**
 * Things a raider puts on the ground.
 *
 * Five presses that answer one question — "was the Mother Shahraz kit down" —
 * and that the rest of this app would otherwise file in two unrelated places:
 * four are items and count as consumables, one is a hunter ability and counts
 * as a cooldown. Both are correct and neither, on its own, lets an officer read
 * the pull.
 *
 * So this list is a **third view of casts already being fetched**, not a new
 * fetch. Every id here must also appear in `TRACKED_CAST_IDS` (the items) or
 * `COOLDOWN_CAST_IDS` (the ability) — that is what puts it in the server-side
 * casts filter, and a deployable missing from both would be curated, reviewed,
 * merged and silently never seen. `deployables.test.ts` pins that.
 *
 * Ids and spellings were read off this guild's 30 Aug MH+BT report, on the four
 * Mother Shahraz pulls. Warcraft Logs names three of the four items after the
 * thing they *summon* rather than the item — `loggedAs` keeps its spelling so a
 * probe against the report still finds them.
 */

import type { Profession } from "@/lib/constants/wow";

export interface Deployable {
  /** WCL spell id — the match key. */
  id: number;
  /** What the app calls it: the item, or the ability's own name. */
  label: string;
  /** Warcraft Logs' own spelling, when it differs from the label. */
  loggedAs?: string;
  /**
   * An item somebody bought and brought, or a class ability they pressed.
   *
   * The distinction is not cosmetic: an item is priced and counted as spend,
   * an ability is neither. It is also the evidence — a press that turns up on
   * six or seven different classes is an item by definition.
   */
  kind: "item" | "ability";
  /** Set only on an ability. */
  wowClass?: string;
  /**
   * The profession it takes to set one off, when it takes one.
   *
   * The same claim `analysis/professions.ts` makes about a sapper charge, about
   * two more engineering devices: an engineering explosive cannot be used by
   * somebody without the skill. It runs in one direction only — it says who
   * *could* have laid one, never that a raider without the profession recorded
   * couldn't (the roster is hand-entered and routinely blank).
   */
  profession?: Profession;
}

export const DEPLOYABLES: Deployable[] = [
  /* 16 casts on the probed pulls, from warriors, rogues, shamans and hunters. */
  { id: 4100, label: "Goblin Land Mine", kind: "item", profession: "Engineering" },
  /* 10 casts across six classes. The log names the plant, not the seed. */
  { id: 22792, label: "Thornling Seed", loggedAs: "Plant Thornling", kind: "item" },
  /* 12 casts across seven classes. The log names the hound, not the whistle. */
  { id: 9515, label: "Dog Whistle", loggedAs: "Summon Tracking Hound", kind: "item" },
  /*
   * The only one with a cast time, so it emits `begincast` as well as `cast` —
   * 3 real casts against 6 events on the probed night. normalize drops
   * `begincast`, which is the whole reason those are not six turrets.
   */
  { id: 30526, label: "Gnomish Flame Turret", loggedAs: "Flame Turret", kind: "item", profession: "Engineering" },
  /* 17 casts from three hunters. Pressed, not bought — see `kind`. */
  { id: 34600, label: "Snake Trap", kind: "ability", wowClass: "Hunter" },
];

export const DEPLOYABLE_BY_ID = new Map<number, Deployable>(DEPLOYABLES.map((d) => [d.id, d]));

/** Labels, for a reader that has a stored cast moment and only its name. */
export const DEPLOYABLE_LABELS = new Set(DEPLOYABLES.map((d) => d.label));

export function deployableOf(spellId: number | undefined): Deployable | undefined {
  return spellId === undefined ? undefined : DEPLOYABLE_BY_ID.get(spellId);
}

/** Labels of the devices a given profession is what lets you lay. */
export function deployableLabelsFor(profession: Profession): Set<string> {
  return new Set(DEPLOYABLES.filter((d) => d.profession === profession).map((d) => d.label));
}
