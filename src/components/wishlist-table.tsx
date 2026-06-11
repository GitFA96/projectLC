import { SLOT_LABELS } from "@/lib/constants/wow";
import { ItemLink, type ItemRef } from "@/components/item-link";
import { AcquiredBadge } from "@/components/acquired-badge";
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
}

/**
 * The slots where the wishlist differs from current gear (upgrades wanted),
 * with acquisition status. Slots already matching current gear are omitted —
 * they count toward completion but aren't actionable.
 */
export function WishlistTable({ rows }: { rows: WishlistRowView[] }) {
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
            <TableCell>
              {row.current ? (
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
