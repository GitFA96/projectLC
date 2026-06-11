import Link from "next/link";
import { CLASS_COLORS, CLASS_TEXT_COLORS } from "@/lib/constants/wow";
import type { WowClass } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Class chip: canonical class color as a soft background with a darkened,
 * light-theme-legible text color. Works for Priest white / Rogue yellow too.
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
        backgroundColor: `${CLASS_COLORS[wowClass]}2b`,
        borderColor: `${CLASS_COLORS[wowClass]}66`,
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
