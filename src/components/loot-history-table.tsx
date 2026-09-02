"use client";

import * as React from "react";
import { format, parseISO } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Pager } from "@/components/ui/pager";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ItemLink, type ItemRef } from "@/components/item-link";
import { OffSpecConflict } from "@/components/loot/offspec-conflict";
import { AwardEditButton } from "@/components/loot/award-edit-button";
import type { AwardDialogTarget } from "@/components/loot-award-dialog";
import type { AwardWishlistMatch, WowClass } from "@/lib/types";

/**
 * One recorded award, flattened for display.
 *
 * Built server-side because everything in it is a join the page has already
 * done — the item cache's name for the id, the session's zones, the ledger's
 * edit target. The client half of this component only decides which twenty of
 * them are on screen.
 */
export interface LootHistoryRow {
  id: string;
  /** ISO instant the item was won — the date half is what's shown. */
  awardedAt: string;
  item: ItemRef;
  /** The night's zones, as the ledger names them. */
  raid: string;
  offspec: boolean;
  wishlist: AwardWishlistMatch;
  note?: string;
  /** What the ledger's edit dialog needs. Rendered only with `loot.award`. */
  edit: AwardDialogTarget;
}

/**
 * A page of loot history. Long enough that a normal raider's whole record is
 * one page, short enough that a two-year main doesn't bury the rest of the
 * profile under three hundred rows.
 */
const PAGE_SIZE = 20;

/**
 * A character's loot history, newest first and paged.
 *
 * Paged in the client, over rows the server already sent, because this is the
 * bottom of a page whose other seven panels are expensive to rebuild — turning
 * a loot page should not re-run the character's whole performance query. That
 * is also why the page index is not in the URL, unlike the gear and report
 * pickers above it: those choose *what the page is about* and are pasted at
 * other officers; this one is scroll position.
 */
export function LootHistoryTable({
  rows,
  roster,
  canEdit,
  canAmend,
}: {
  /** Every award, newest first — the whole history, not a page of it. */
  rows: LootHistoryRow[];
  /** Winner candidates for the edit dialog. Empty unless the viewer may edit. */
  roster: { id: string; name: string; wowClass: WowClass }[];
  canEdit: boolean;
  canAmend: boolean;
}) {
  const [pageIndex, setPageIndex] = React.useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  // An edit can hand the item to somebody else, which takes the row off this
  // character — and the last page with it, if it was the only one there.
  const page = Math.min(pageIndex, pageCount - 1);
  const visible = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  if (rows.length === 0) {
    return <p className="py-2 text-sm text-muted-foreground">No items awarded yet.</p>;
  }

  return (
    <div className="space-y-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-28">Date</TableHead>
            <TableHead>Item</TableHead>
            <TableHead>Raid</TableHead>
            <TableHead className="w-24">Type</TableHead>
            <TableHead className="w-28">Wishlist</TableHead>
            <TableHead>Note</TableHead>
            {canEdit && <TableHead className="w-16" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="tabular-nums text-muted-foreground">
                {format(parseISO(row.awardedAt), "d MMM yyyy")}
              </TableCell>
              <TableCell>
                <ItemLink item={row.item} />
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">{row.raid}</TableCell>
              <TableCell>
                {row.offspec ? (
                  <Badge variant="warning">Off-spec</Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">Main spec</span>
                )}
              </TableCell>
              <TableCell>
                {row.wishlist.matched ? (
                  <div className="flex flex-col items-start gap-0.5">
                    <Badge
                      variant="success"
                      title={
                        row.wishlist.redeemsTo
                          ? `Buys ${row.wishlist.redeemsTo.itemName}, which is on their wishlist`
                          : undefined
                      }
                    >
                      {row.wishlist.phases.map((p) => `P${p}`).join(", ")} wishlist
                    </Badge>
                    <OffSpecConflict
                      offspec={row.offspec}
                      matched={row.wishlist.matched}
                      phases={row.wishlist.phases}
                      redeemsTo={row.wishlist.redeemsTo}
                    />
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground/50">—</span>
                )}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">{row.note ?? ""}</TableCell>
              {canEdit && (
                <TableCell className="text-right">
                  <AwardEditButton roster={roster} canAmend={canAmend} target={row.edit} />
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pager
        pageIndex={page}
        pageCount={pageCount}
        total={rows.length}
        pageSize={PAGE_SIZE}
        onPrev={() => setPageIndex(page - 1)}
        onNext={() => setPageIndex(page + 1)}
      />
    </div>
  );
}
