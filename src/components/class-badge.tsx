import Link from "next/link";
import { CLASS_TEXT_COLORS, classTint } from "@/lib/constants/wow";
import type { WowClass } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Class chip: the class color as a soft background with a theme-legible text
 * color.
 *
 * Goes through `classTint` rather than tinting `CLASS_COLORS` directly,
 * because Priest's canonical color is pure white — mixed into a light page it
 * produced a chip with no visible background at all. `classTint` substitutes
 * the slate that Priest's text color comes from, and carries the per-theme
 * alpha, since a wash that reads on white disappears on near-black.
 */
export function ClassBadge({
  wowClass,
  spec,
  className,
}: {
  wowClass: WowClass;
  spec?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap",
        className,
      )}
      style={{
        backgroundColor: classTint(wowClass, "var(--class-chip-bg-alpha)"),
        borderColor: classTint(wowClass, "var(--class-chip-line-alpha)"),
        color: CLASS_TEXT_COLORS[wowClass],
      }}
    >
      {spec ? `${spec} ${wowClass}` : wowClass}
    </span>
  );
}

/**
 * Character name link in (legible) class color.
 *
 * Underlined at rest, not only on hover. Class color already makes these names
 * *stand out*, which is not the same as looking clickable — on a page like the
 * loot plan, where every other coloured word is an item, a council reading down
 * a boss had no way to tell the contenders were reachable without hovering
 * each one. The underline is dotted and offset so a row of four names still
 * reads as a row of names, and goes solid on hover to confirm the target.
 */
export function CharacterLink({
  name,
  wowClass,
  className,
}: {
  name: string;
  wowClass: WowClass;
  className?: string;
}) {
  return (
    <Link
      href={`/characters/${encodeURIComponent(name.toLowerCase())}`}
      className={cn(
        "font-semibold underline decoration-dotted decoration-from-font underline-offset-2",
        "opacity-100 transition-[text-decoration-color] hover:decoration-solid",
        className,
      )}
      style={{ color: CLASS_TEXT_COLORS[wowClass] }}
    >
      {name}
    </Link>
  );
}
