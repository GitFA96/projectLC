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

/** Character name link in (legible) class color. */
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
      className={cn("font-semibold hover:underline", className)}
      style={{ color: CLASS_TEXT_COLORS[wowClass] }}
    >
      {name}
    </Link>
  );
}
