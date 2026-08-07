"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import {
  clearCurrentSlotsAction,
  setCurrentSlotAction,
  type SetCurrentSlotInput,
} from "@/app/characters/[name]/current-gear-actions";
import { ItemIcon } from "@/components/item-icon";
import { ItemLink, type ItemRef } from "@/components/item-link";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from "@/components/ui/select";
import { QUALITY_TEXT_COLORS, SLOT_LABELS } from "@/lib/constants/wow";
import type { Quality, SlotId } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * "What are they actually wearing here?", answered from the logs.
 *
 * The imported SixtyUpgrades set is a snapshot of intent and goes stale the
 * moment someone wins an upgrade — so this lets an officer pin the slot to a
 * piece the raider was logged wearing, right where the staleness shows: the
 * "Currently" column of a wishlist row. Pinning is one write; everything the
 * loot council reads (the row's status, phase completion, contention) follows.
 */

export interface CurrentSlotOptionView {
  itemId: number;
  name?: string;
  quality?: Quality;
  icon?: string;
  /** "12 of 18 pulls · Hydross ×8" — the evidence, shown under the name. */
  detail: string;
  /** Seen on the paired slot (the other ring / trinket), not this one. */
  fromPairedSlot: boolean;
  /** Worn in this slot on their most recent logged pull. */
  latest: boolean;
}

/** Unpin: hand the slot back to the imported set (or to nothing at all). */
const UNPIN = "none";
const logValue = (itemId: number) => `log:${itemId}`;

function OptionRow({
  item,
  detail,
  note,
}: {
  item: ItemRef;
  detail?: string;
  note?: string;
}) {
  const quality = item.quality ?? "common";
  return (
    <span className="flex min-w-0 items-center gap-2">
      <ItemIcon icon={item.icon} quality={quality} size={18} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium" style={{ color: QUALITY_TEXT_COLORS[quality] }}>
          {item.name ?? `Item #${item.itemId}`}
          {note && <span className="ml-1 font-normal text-muted-foreground">{note}</span>}
        </span>
        {detail && <span className="truncate text-[11px] text-muted-foreground">{detail}</span>}
      </span>
    </span>
  );
}

export function CurrentSlotPicker({
  characterName,
  slot,
  current,
  pinned,
  imported,
  options,
}: {
  characterName: string;
  slot: SlotId;
  /** What's recorded in the slot right now — pinned item, or the import's. */
  current?: ItemRef;
  /** True when `current` is a pin rather than the imported set's own answer. */
  pinned: boolean;
  /** The imported set's item for this slot, when it has one — the revert target. */
  imported?: ItemRef;
  /** Items logged in this slot (or its pair) over the recent raid nights. */
  options: CurrentSlotOptionView[];
}) {
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const value = pinned && current ? logValue(current.itemId) : UNPIN;
  // A pin can outlive the raids it was read from — keep it selectable/visible.
  const pinnedIsListed = !pinned || !current || options.some((o) => o.itemId === current.itemId);

  const pick = (next: string) => {
    if (next === value) return;
    setError(null);
    const input: SetCurrentSlotInput = {
      characterName,
      slot,
      itemId: next === UNPIN ? null : Number(next.slice("log:".length)),
    };
    startTransition(async () => {
      const result = await setCurrentSlotAction(input);
      if (!result.ok) setError(result.message);
    });
  };

  return (
    <span className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1">
        {current ? (
          <ItemLink item={current} size="sm" className={cn("min-w-0", !pinned && "opacity-60")} />
        ) : (
          <span className="text-xs text-muted-foreground/50">—</span>
        )}
        {pinned && (
          <Badge
            variant="secondary"
            className="shrink-0 px-1 py-0 text-[10px] font-normal"
            title="Set by hand from their logged gear — overrides the imported set"
          >
            set
          </Badge>
        )}
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <Select value={value} onValueChange={pick}>
            <SelectTrigger
              className="h-6 w-6 shrink-0 justify-center border-0 bg-transparent p-0 text-muted-foreground shadow-none hover:text-foreground"
              aria-label={`Set what ${characterName} has in ${SLOT_LABELS[slot]}`}
              title={`Set what ${characterName} currently has in ${SLOT_LABELS[slot]}`}
            />
            <SelectContent className="max-w-88">
              {options.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Worn in their recent raids</SelectLabel>
                  {options.map((option) => (
                    <SelectItem key={option.itemId} value={logValue(option.itemId)}>
                      <OptionRow
                        item={option}
                        detail={option.detail}
                        note={
                          option.fromPairedSlot
                            ? "· other slot"
                            : option.latest
                              ? "· newest pull"
                              : undefined
                        }
                      />
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              {!pinnedIsListed && current && (
                <SelectGroup>
                  <SelectLabel>Pinned</SelectLabel>
                  <SelectItem value={logValue(current.itemId)}>
                    <OptionRow item={current} detail="No longer in their recent raids" />
                  </SelectItem>
                </SelectGroup>
              )}
              <SelectGroup>
                <SelectLabel>{imported ? "Imported set" : "Unset"}</SelectLabel>
                <SelectItem value={UNPIN}>
                  {imported ? (
                    <OptionRow item={imported} detail="What their SixtyUpgrades export says" />
                  ) : (
                    <span className="text-sm text-muted-foreground">Nothing recorded</span>
                  )}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        )}
      </span>
      {error && <span className="text-[11px] text-danger-ink">{error}</span>}
    </span>
  );
}

/**
 * Undo every pin at once — the escape hatch for slots no wishlist row covers
 * (and the honest answer to "just use what they exported" after a re-import).
 */
export function ResetPinnedSlotsButton({
  characterName,
  count,
}: {
  characterName: string;
  count: number;
}) {
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  if (count === 0) return null;
  return (
    <>
      {" · "}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await clearCurrentSlotsAction(characterName);
            if (!result.ok) setError(result.message);
          });
        }}
        className="cursor-pointer font-medium text-foreground underline-offset-2 hover:underline disabled:opacity-50"
        title="Drop every slot set by hand and go back to the imported set"
      >
        {pending ? "Resetting…" : `Reset ${count} slot${count === 1 ? "" : "s"} set by hand`}
      </button>
      {error && <span className="ml-1 text-danger-ink">{error}</span>}
    </>
  );
}
