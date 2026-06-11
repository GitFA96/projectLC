import { SLOT_META } from "@/lib/constants/wow";
import { ItemLink, type ItemRef } from "@/components/item-link";
import type { SlotId } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface SlotRowView {
  slot: SlotId;
  item?: ItemRef;
  enchant?: string;
  gems?: string[];
}

/**
 * Paper-doll as a compact list: all 17 slots in canonical order, with
 * enchant/gem presence dots as quick audit hints.
 */
export function SlotGrid({ slots }: { slots: SlotRowView[] }) {
  const bySlot = new Map(slots.map((s) => [s.slot, s]));
  return (
    <ul className="divide-y">
      {SLOT_META.map(({ id, label }) => {
        const row = bySlot.get(id);
        return (
          <li key={id} className="flex items-center gap-2 py-1.5">
            <span className="w-16 shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {label}
            </span>
            {row?.item ? (
              <>
                <ItemLink item={row.item} className="min-w-0 flex-1" />
                <span className="flex shrink-0 items-center gap-1">
                  {row.enchant && (
                    <span
                      title={`Enchant: ${row.enchant}`}
                      className="h-2 w-2 rounded-full bg-emerald-500"
                    />
                  )}
                  {(row.gems ?? []).map((gem, i) => (
                    <span
                      key={i}
                      title={`Gem: ${gem}`}
                      className="h-2 w-2 rounded-full border border-violet-300 bg-violet-200"
                    />
                  ))}
                </span>
              </>
            ) : (
              <span className={cn("flex-1 text-sm text-muted-foreground/50")}>—</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
