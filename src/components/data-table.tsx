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
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
}: {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  initialSorting?: SortingState;
  emptyMessage?: string;
  /** Rows per page. Pass Infinity to render everything, as before. */
  pageSize?: number;
}) {
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting);
  const paginated = Number.isFinite(pageSize);
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    // Filtering happens above this component, so a filter change arrives as new
    // `data`. autoResetPageIndex (on by default) sends the reader back to page
    // one for it — otherwise narrowing a search from page 4 shows an empty table.
    ...(paginated
      ? { getPaginationRowModel: getPaginationRowModel(), initialState: { pagination: { pageSize } } }
      : {}),
  });

  const pageCount = table.getPageCount();
  const { pageIndex } = table.getState().pagination;
  const total = table.getFilteredRowModel().rows.length;
  const firstOnPage = pageIndex * pageSize + 1;
  const lastOnPage = Math.min((pageIndex + 1) * pageSize, total);

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
        <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span className="tabular-nums">
            {firstOnPage}–{lastOnPage} of {total}
          </span>
          <span className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              aria-label="Previous page"
              className="inline-flex h-7 items-center gap-1 rounded-md border px-2 transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="h-3 w-3" aria-hidden />
              Prev
            </button>
            <span className="px-1 tabular-nums">
              {pageIndex + 1} / {pageCount}
            </span>
            <button
              type="button"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              aria-label="Next page"
              className="inline-flex h-7 items-center gap-1 rounded-md border px-2 transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
              <ChevronRight className="h-3 w-3" aria-hidden />
            </button>
          </span>
        </div>
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
