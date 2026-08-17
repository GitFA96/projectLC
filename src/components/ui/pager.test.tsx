import { describe, expect, it } from "vitest";
import { pagerRange } from "@/components/ui/pager";

/**
 * The range the pager prints, which is arithmetic rather than markup and is
 * where this control goes wrong.
 *
 * It was briefly derived as `ceil(total / pageCount)`, which looks like the
 * page size and is not: 34 rows across 4 pages of 10 gives 9, so every page
 * printed a range one row short and the last page claimed rows that were not
 * there. Cheap to get wrong, invisible in a screenshot, wrong on every page.
 */
describe("pagerRange", () => {
  it("counts from one, not zero", () => {
    expect(pagerRange(0, 10, 34)).toEqual({ first: 1, last: 10 });
  });

  it("walks a full page at a time", () => {
    expect(pagerRange(1, 10, 34)).toEqual({ first: 11, last: 20 });
    expect(pagerRange(2, 10, 34)).toEqual({ first: 21, last: 30 });
  });

  it("stops the last page at the real total", () => {
    // The page holds 10; only 4 rows exist to fill it.
    expect(pagerRange(3, 10, 34)).toEqual({ first: 31, last: 34 });
  });

  it("handles an exactly-full last page", () => {
    expect(pagerRange(3, 10, 40)).toEqual({ first: 31, last: 40 });
  });

  it("survives a total smaller than one page", () => {
    expect(pagerRange(0, 10, 3)).toEqual({ first: 1, last: 3 });
  });
});
