/**
 * Officer comment categories — a small, loot-council-relevant taxonomy so a
 * note can be filed and colored (a "missed two resets, told us in advance"
 * attendance note reads differently from a "ninja-pulled Vashj" conduct one).
 * "note" is the neutral default.
 */
export const COMMENT_CATEGORIES = [
  "note",
  "performance",
  "attendance",
  "conduct",
  "loot",
] as const;
export type CommentCategory = (typeof COMMENT_CATEGORIES)[number];

export const COMMENT_CATEGORY_LABELS: Record<CommentCategory, string> = {
  note: "Note",
  performance: "Performance",
  attendance: "Attendance",
  conduct: "Conduct",
  loot: "Loot",
};

/** Badge variant per category (maps to the shared Badge component variants). */
export const COMMENT_CATEGORY_VARIANT: Record<
  CommentCategory,
  "muted" | "secondary" | "warning" | "destructive" | "success"
> = {
  note: "muted",
  performance: "secondary",
  attendance: "warning",
  conduct: "destructive",
  loot: "success",
};
