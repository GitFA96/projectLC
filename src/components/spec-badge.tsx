import { CLASS_TEXT_COLORS } from "@/lib/constants/wow";
import type { WowClass } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Spec chip with the classic talent-tab icon — the at-a-glance answer to
 * "Affliction or Destro? Fury or Arms?". Built for WCL's spec strings, which
 * vary in spacing ("Beast Mastery" / "BeastMastery"), so keys are normalized.
 */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/** `${class}:${spec}` (normalized) → zamimg icon name (classic talent tabs). */
const SPEC_ICONS: Record<string, string> = {
  "warrior:arms": "ability_rogue_eviscerate",
  "warrior:fury": "ability_warrior_innerrage",
  "warrior:protection": "ability_warrior_defensivestance",
  "paladin:holy": "spell_holy_holybolt",
  "paladin:protection": "spell_holy_devotionaura",
  "paladin:retribution": "spell_holy_auraoflight",
  "hunter:beastmastery": "ability_hunter_beasttaming",
  "hunter:marksmanship": "ability_marksmanship",
  "hunter:survival": "ability_hunter_swiftstrike",
  "rogue:assassination": "ability_rogue_eviscerate",
  "rogue:combat": "ability_backstab",
  "rogue:subtlety": "ability_stealth",
  "priest:discipline": "spell_holy_wordfortitude",
  "priest:holy": "spell_holy_holybolt",
  "priest:smiter": "spell_holy_holysmite",
  "priest:shadow": "spell_shadow_shadowwordpain",
  "shaman:elemental": "spell_nature_lightning",
  "shaman:enhancement": "spell_nature_lightningshield",
  "shaman:restoration": "spell_nature_magicimmunity",
  "mage:arcane": "spell_holy_magicalsentry",
  "mage:fire": "spell_fire_firebolt02",
  "mage:frost": "spell_frost_frostbolt02",
  "warlock:affliction": "spell_shadow_deathcoil",
  "warlock:demonology": "spell_shadow_metamorphosis",
  "warlock:destruction": "spell_shadow_rainoffire",
  "druid:balance": "spell_nature_starfall",
  "druid:feral": "ability_druid_catform",
  "druid:guardian": "ability_racial_bearform",
  // WCL's names for the tank flavours of feral/protection in TBC logs.
  "druid:warden": "ability_racial_bearform",
  // And the roster's own: a character's spec is free text an officer types, so
  // "Feral Tank" is a real value the talent trees have no name for. Bear, not
  // cat — that's what the words say, not a guess about the build.
  "druid:feraltank": "ability_racial_bearform",
  "paladin:justicar": "spell_holy_devotionaura",
  "druid:restoration": "spell_nature_healingtouch",
  // The hybrid Balance/Resto build WCL labels Dreamstate, which this guild's
  // own pulls carry, so it needs a face wherever a spec is shown as an icon.
  "druid:dreamstate": "ability_druid_dreamstate",
};

/**
 * The talent-tab icon for a spec, or undefined when we have none for it.
 *
 * Falls back to the spec's **first word** when the whole string misses, because
 * a character's spec is free text an officer types: the roster carries "Feral
 * Tank", and the next officer will write "Holy PvP" or "Resto OS". One missing
 * icon in a row of them reads as a broken chip rather than as an unusual spec,
 * so a qualified name gets the icon of the spec it qualifies. Only the first
 * word, and only on an exact miss — "Beast Mastery" resolves whole and must
 * never fall through to a "Beast" that doesn't exist.
 */
export function specIcon(wowClass: string | undefined, spec: string): string | undefined {
  if (!wowClass) return undefined;
  const cls = norm(wowClass);
  const exact = SPEC_ICONS[`${cls}:${norm(spec)}`];
  if (exact) return exact;
  const firstWord = spec.trim().split(/\s+/)[0];
  return firstWord ? SPEC_ICONS[`${cls}:${norm(firstWord)}`] : undefined;
}

/** Pretty-print WCL's squished spec strings ("BeastMastery" → "Beast Mastery"). */
export function specLabel(spec: string): string {
  return spec.replace(/([a-z])([A-Z])/g, "$1 $2");
}

export function SpecBadge({
  spec,
  wowClass,
  title,
  className,
  iconOnly = false,
}: {
  spec: string;
  /** Class string (roster enum or WCL's) — drives color + icon lookup. */
  wowClass?: string;
  title?: string;
  className?: string;
  /**
   * Drop the label and show the talent-tab icon alone — for dense tables where
   * the spec is a hint, not a column. Renders nothing when the spec has no
   * icon: an empty chip would just be a gap the reader has to explain.
   */
  iconOnly?: boolean;
}) {
  const icon = specIcon(wowClass, spec);
  if (iconOnly && !icon) return null;
  const color =
    wowClass && wowClass in CLASS_TEXT_COLORS
      ? CLASS_TEXT_COLORS[wowClass as WowClass]
      : undefined;
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap", className)}
      title={title}
    >
      {icon && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`https://wow.zamimg.com/images/wow/icons/small/${icon}.jpg`}
          alt=""
          width={16}
          height={16}
          className="rounded-sm border border-foreground/20"
        />
      )}
      {!iconOnly && <span style={color ? { color } : undefined}>{specLabel(spec)}</span>}
    </span>
  );
}
