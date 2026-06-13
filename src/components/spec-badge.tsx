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
  "druid:restoration": "spell_nature_healingtouch",
};

/** Pretty-print WCL's squished spec strings ("BeastMastery" → "Beast Mastery"). */
export function specLabel(spec: string): string {
  return spec.replace(/([a-z])([A-Z])/g, "$1 $2");
}

export function SpecBadge({
  spec,
  wowClass,
  title,
  className,
}: {
  spec: string;
  /** Class string (roster enum or WCL's) — drives color + icon lookup. */
  wowClass?: string;
  title?: string;
  className?: string;
}) {
  const icon = wowClass ? SPEC_ICONS[`${norm(wowClass)}:${norm(spec)}`] : undefined;
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
          className="rounded-sm border border-black/20"
        />
      )}
      <span style={color ? { color } : undefined}>{specLabel(spec)}</span>
    </span>
  );
}
