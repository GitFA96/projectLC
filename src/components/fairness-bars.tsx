import { CLASS_TINT_COLORS } from "@/lib/constants/wow";
import { CharacterLink } from "@/components/class-badge";
import type { WowClass } from "@/lib/types";

export interface FairnessBarEntry {
  name: string;
  wowClass: WowClass;
  onSpec: number;
  offSpec: number;
}

/**
 * Horizontal mini-bars of awards per character, class-colored.
 * Off-spec awards render as a faded extension of the bar.
 */
export function FairnessBars({ entries }: { entries: FairnessBarEntry[] }) {
  const max = Math.max(1, ...entries.map((e) => e.onSpec + e.offSpec));
  return (
    <div className="space-y-1.5">
      {entries.map((e) => (
        <div key={e.name} className="flex items-center gap-2 text-xs">
          <span className="w-20 shrink-0 truncate">
            <CharacterLink name={e.name} wowClass={e.wowClass} className="text-xs font-medium" />
          </span>
          <span className="flex h-3 flex-1 items-center gap-px overflow-hidden rounded-sm bg-muted/60">
            <span
              className="h-full rounded-l-sm"
              style={{
                width: `${(e.onSpec / max) * 100}%`,
                backgroundColor: CLASS_TINT_COLORS[e.wowClass],
              }}
            />
            <span
              className="h-full"
              style={{
                width: `${(e.offSpec / max) * 100}%`,
                backgroundColor: CLASS_TINT_COLORS[e.wowClass],
                opacity: 0.35,
              }}
            />
          </span>
          <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">
            {e.onSpec}
            {e.offSpec > 0 && <span className="opacity-60"> +{e.offSpec}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
