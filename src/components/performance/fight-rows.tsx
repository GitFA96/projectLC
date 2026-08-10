"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface FightRowData {
  id: string;
  /** The regular table cells, rendered on the server. */
  cells: React.ReactNode;
  /** Expanded per-pull detail (server-rendered); null = nothing to show. */
  detail: React.ReactNode | null;
  /**
   * The officer took this pull out of the count. Still shown — what happened on
   * a farm boss is worth reading — but muted, so nothing in the row reads as a
   * mark against the raider.
   */
  excused?: boolean;
}

/**
 * Table body rows with a per-boss expander: clicking a row folds out the
 * pull's detail (consumables used, cooldowns, upkeep) underneath it.
 */
export function FightRows({ rows, colSpan }: { rows: FightRowData[]; colSpan: number }) {
  const [open, setOpen] = React.useState<Record<string, boolean>>({});

  return (
    <>
      {rows.map((row) => {
        const isOpen = open[row.id] === true;
        return (
          <React.Fragment key={row.id}>
            <TableRow
              className={cn(row.detail && "cursor-pointer", row.excused && "opacity-55")}
              onClick={
                row.detail ? () => setOpen((o) => ({ ...o, [row.id]: !isOpen })) : undefined
              }
              title={row.detail ? "Show pull details" : undefined}
              aria-expanded={row.detail ? isOpen : undefined}
            >
              <TableCell className="w-6 pr-0">
                {row.detail && (
                  <ChevronRight
                    className={cn(
                      "h-3.5 w-3.5 text-muted-foreground transition-transform",
                      isOpen && "rotate-90",
                    )}
                    aria-hidden
                  />
                )}
              </TableCell>
              {row.cells}
            </TableRow>
            {row.detail && isOpen && (
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableCell colSpan={colSpan} className="px-4 py-2.5">
                  {row.detail}
                </TableCell>
              </TableRow>
            )}
          </React.Fragment>
        );
      })}
    </>
  );
}
