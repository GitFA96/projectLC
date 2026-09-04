/**
 * Every type the app passes around, in one import path.
 *
 * The declarations live in `types/` by domain; this file is the only thing
 * anything else imports, so a type moving between domains costs no import
 * change anywhere. Add a domain file and re-export it here.
 *
 * The file and the directory sit side by side on purpose: `@/lib/types`
 * resolves to this file, and `@/lib/types/loot` to one part, so a module
 * that genuinely wants one domain can say so.
 */

/* The game's own vocabulary, re-exported so a caller needs one import. */
export type {
  CharacterStatus,
  GearOverrideSource,
  GearSpec,
  Phase,
  Profession,
  Quality,
  Role,
  SlotId,
  WowClass,
} from "@/lib/constants/wow";

export type * from "@/lib/types/entities";
export type * from "@/lib/types/identity";
export type * from "@/lib/types/roster";
export type * from "@/lib/types/loot";
export type * from "@/lib/types/performance";
export type * from "@/lib/types/sim";
export type * from "@/lib/types/raid";
export type * from "@/lib/types/season";
export type * from "@/lib/types/comparison";
export type * from "@/lib/types/dashboard";
