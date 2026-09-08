import type { Role, WowClass } from "@/lib/constants/wow";
import type { WclRole } from "@/lib/types";

/**
 * What a logged pull says about a raider's role.
 *
 * Warcraft Logs answers in three buckets — tank, healer, dps — and the roster
 * wants four, because melee and ranged want different enchants and different
 * seats. So the third bucket is split by spec, and by class where the spec is
 * missing, which is a guess and is treated as one everywhere it lands: on the
 * roster it is the prefilled value of a field an officer can edit, and on a
 * logged name's page it only decides which enchant the audit calls correct.
 *
 * Shared rather than copied because those two places must not disagree. The
 * same pug, tracked onto the roster and read on their own page, has to grade
 * against the same reference — a Melee DPS on one page and a Ranged DPS on the
 * other would flag opposite halves of their gear.
 */
const MELEE_SPECS = new Set([
  "arms",
  "fury",
  "combat",
  "assassination",
  "subtlety",
  "enhancement",
  "feral",
  "retribution",
]);

/** Best-effort Role from what the log knows; always editable afterwards. */
export function guessRole(wclRole: WclRole | undefined, wowClass: WowClass, spec?: string): Role {
  if (wclRole === "tank") return "Tank";
  if (wclRole === "healer") return "Healer";
  if (spec && MELEE_SPECS.has(spec.toLowerCase())) return "Melee DPS";
  return ["Warrior", "Rogue", "Paladin"].includes(wowClass) ? "Melee DPS" : "Ranged DPS";
}
