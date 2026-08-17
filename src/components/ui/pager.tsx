"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Prev / page / next, with the range it is showing.
 *
 * Extracted so the two paged tables in the app cannot drift into two different
 * looks for the same control. It owns no state: the caller keeps the page
 * index, because the caller is the one that has to clamp it when rows go away
 * underneath it (delete a pug on the last page and that page stops existing).
 *
 * The range is spelled out — "11–20 of 34" — because a bare "2 / 4" leaves a
 * reader who is selecting rows guessing how much is behind the control.
 */
export function Pager({
  pageIndex,
  pageCount,
  total,
  pageSize,
  onPrev,
  onNext,
  className,
}: {
  /** Zero-based, as every caller's state naturally is. */
  pageIndex: number;
  pageCount: number;
  total: number;
  /**
   * Rows per page — passed, never derived. `ceil(total / pageCount)` looks
   * equivalent and isn't: 34 rows across 4 pages of 10 gives 9, and every range
   * the control prints is then quietly off by one page's worth.
   */
  pageSize: number;
  onPrev: () => void;
  onNext: () => void;
  className?: string;
}) {
  if (pageCount <= 1) return null;
  const { first, last } = pagerRange(pageIndex, pageSize, total);

  return (
    <div
      className={
        className ?? "mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground"
      }
    >
      <span className="tabular-nums">
        {first}–{last} of {total}
      </span>
      <span className="flex items-center gap-1">
        <button
          type="button"
          onClick={onPrev}
          disabled={pageIndex === 0}
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
          onClick={onNext}
          disabled={pageIndex >= pageCount - 1}
          aria-label="Next page"
          className="inline-flex h-7 items-center gap-1 rounded-md border px-2 transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
          <ChevronRight className="h-3 w-3" aria-hidden />
        </button>
      </span>
    </div>
  );
}

/**
 * Which rows this page is showing, one-based for a reader.
 *
 * Exported so the arithmetic can be tested without a DOM — it is the only part
 * of this control that can be wrong in a way nobody notices.
 */
export function pagerRange(
  pageIndex: number,
  pageSize: number,
  total: number,
): { first: number; last: number } {
  return {
    first: pageIndex * pageSize + 1,
    last: Math.min((pageIndex + 1) * pageSize, total),
  };
}
