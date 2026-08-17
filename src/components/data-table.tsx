"use client";

import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pager } from "@/components/ui/pager";
import { cn } from "@/lib/utils";

/**
 * How many rows to put in the DOM at once.
 *
 * Chosen so the pages that were slow get paged and the ones that were fine
 * don't change: the roster is under this and still renders in one go, while
 * the loot ledger and the item list — which were laying out several hundred to
 * over a thousand rows on every visit — no longer pay for rows nobody scrolled
 * to. Sorting and filtering still run over the whole set; only the rendering
 * is windowed.
 */
const DEFAULT_PAGE_SIZE = 100;

/**
 * Sortable compact table. Filtering is the caller's job: pass pre-filtered
 * `data` (keeps filter UIs free-form per page while sharing the table shell).
 *
 * Memoized (see the export below): a page that re-renders for a reason the
 * table doesn't care about — a row being ticked, a toolbar count changing —
 * should not redraw every row. That only holds if the caller keeps `columns`,
 * `data` and `initialSorting` referentially stable, so pass memos or module
 * constants, never inline literals.
 */
function DataTableImpl<TData>({
  columns,
  data,
  initialSorting = [],
  emptyMessage = "No results.",
  pageSize = DEFAULT_PAGE_SIZE,
  resetPageOn,
}: {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  initialSorting?: SortingState;
  emptyMessage?: string;
  /** Rows per page. Pass Infinity to render everything, as before. */
  pageSize?: number;
  /**
   * What the reader changed that should send them back to page one.
   *
   * A string describing the current filters — narrowing a search from page 4
   * must not leave them staring at an empty table. Everything *else* that
   * replaces `data` deliberately keeps the page: saving an edit re-renders the
   * whole ledger from the server, and dropping an officer back to page 1 after
   * every save is what this prop exists to stop. Omit it on a table with no
   * filters above it.
   */
  resetPageOn?: string;
}) {
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting);
  const paginated = Number.isFinite(pageSize);
  /*
   * Pagination is controlled here rather than left to the table's
   * `autoResetPageIndex`, which resets on any new `data` — including the
   * identical rows a router refresh hands back after a save.
   */
  const [pageIndex, setPageIndex] = React.useState(0);
  const [seenReset, setSeenReset] = React.useState(resetPageOn);
  if (resetPageOn !== seenReset) {
    setSeenReset(resetPageOn);
    setPageIndex(0);
  }
  const table = useReactTable({
    data,
    columns,
    state: { sorting, ...(paginated ? { pagination: { pageIndex, pageSize } } : {}) },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    ...(paginated
      ? {
          getPaginationRowModel: getPaginationRowModel(),
          autoResetPageIndex: false,
          onPaginationChange: (updater) => {
            const next =
              typeof updater === "function" ? updater({ pageIndex, pageSize }) : updater;
            setPageIndex(next.pageIndex);
          },
        }
      : {}),
  });

  const pageCount = table.getPageCount();
  const total = table.getFilteredRowModel().rows.length;
  // Deleting the last row on the last page would otherwise strand the reader on
  // a page that no longer exists, with no rows and both arrows disabled.
  if (paginated && pageCount > 0 && pageIndex > pageCount - 1) setPageIndex(pageCount - 1);

  return (
    <div>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="hover:bg-transparent">
              {headerGroup.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const dir = header.column.getIsSorted();
                return (
                  <TableHead key={header.id} style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}>
                    {header.isPlaceholder ? null : canSort ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className={cn(
                          "inline-flex cursor-pointer select-none items-center gap-1 hover:text-foreground",
                          dir && "text-foreground",
                        )}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {dir === "asc" ? (
                          <ArrowUp className="h-3 w-3" />
                        ) : dir === "desc" ? (
                          <ArrowDown className="h-3 w-3" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-40" />
                        )}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-20 text-center text-sm text-muted-foreground">
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {/* Only when there is somewhere to go — a one-page table looks unchanged. */}
      {paginated && pageCount > 1 && (
        <Pager
          pageIndex={pageIndex}
          pageCount={pageCount}
          total={total}
          pageSize={pageSize}
          onPrev={() => table.previousPage()}
          onNext={() => table.nextPage()}
        />
      )}
    </div>
  );
}

/**
 * `React.memo` through a generic component erases the type parameter, so the
 * cast restores the original signature. Behaviourally identical; callers see
 * the same generic `DataTable` as before.
 */
export const DataTable = React.memo(DataTableImpl) as typeof DataTableImpl;
