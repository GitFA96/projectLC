import { SLOT_LABELS } from "@/lib/constants/wow";
import { ItemLink, type ItemRef } from "@/components/item-link";
import { AcquiredBadge } from "@/components/acquired-badge";
import {
  AwardItemButton,
  ClearAwardButton,
  type AwardContext,
} from "@/components/award-item-controls";
import { CurrentSlotPicker, type CurrentSlotOptionView } from "@/components/current-slot-picker";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SlotId, WishlistSlotState } from "@/lib/types";

export interface WishlistRowView {
  slot: SlotId;
  wished: ItemRef;
  current?: ItemRef;
  state: WishlistSlotState;
  awardedAt?: string;
  /** Present when an award satisfied the slot — the handle for clearing it. */
  awardId?: string;
  /** What the "Currently" cell can be set to, when the slot is editable. */
  currentPick?: {
    /** True when `current` was pinned by hand rather than imported. */
    pinned: boolean;
    /** The imported set's item for the slot — what unpinning falls back to. */
    imported?: ItemRef;
    /** Items logged in this slot (or its pair) over the recent raid nights. */
    options: CurrentSlotOptionView[];
  };
}

/**
 * The slots where the wishlist differs from current gear (upgrades wanted),
 * with acquisition status. Slots already matching current gear are omitted —
 * they count toward completion but aren't actionable.
 *
 * With an award context the status column becomes editable: hand the item over
 * without waiting for a Gargul paste, or clear an award that shouldn't have
 * been recorded. Equipped slots have nothing to award — the character already
 * has the item.
 *
 * "Currently" is editable in the same spirit: a row carrying `currentPick` gets
 * a dropdown of what the raider was logged wearing in that slot, so a stale
 * SixtyUpgrades export can be corrected where the staleness is visible rather
 * than by chasing down a re-export.
 */
export function WishlistTable({
  rows,
  characterName,
  award,
}: {
  rows: WishlistRowView[];
  /** Whose gear the "Currently" pickers write to. */
  characterName: string;
  award?: AwardContext;
}) {
  if (rows.length === 0) {
    return (
      <p className="px-1 py-3 text-sm text-muted-foreground">
        Wishlist fully matches current gear — nothing open.
      </p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-20">Slot</TableHead>
          <TableHead>Wanted</TableHead>
          <TableHead className="w-36">Status</TableHead>
          {award && <TableHead className="w-24" />}
          <TableHead>Currently</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={`${row.slot}-${row.wished.itemId}`}>
            <TableCell className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {SLOT_LABELS[row.slot]}
            </TableCell>
            <TableCell>
              <ItemLink item={row.wished} />
            </TableCell>
            <TableCell>
              <AcquiredBadge state={row.state} awardedAt={row.awardedAt} />
            </TableCell>
            {award && (
              <TableCell>
                {row.awardId ? (
                  <ClearAwardButton awardId={row.awardId} />
                ) : row.state === "open" ? (
                  <AwardItemButton ctx={award} prefill={row.wished} />
                ) : null}
              </TableCell>
            )}
            <TableCell>
              {row.currentPick ? (
                <CurrentSlotPicker
                  characterName={characterName}
                  slot={row.slot}
                  current={row.current}
                  pinned={row.currentPick.pinned}
                  imported={row.currentPick.imported}
                  options={row.currentPick.options}
                />
              ) : row.current ? (
                <ItemLink item={row.current} size="sm" className="opacity-60" />
              ) : (
                <span className="text-xs text-muted-foreground/50">—</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
