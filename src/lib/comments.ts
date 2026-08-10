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

/**
 * Who is speaking on an item.
 *
 * The council asked for both, and they are not the same evidence. A raider
 * saying "this is my second choice, I'd rather hold for the T5 helm" is a
 * statement of want that no wishlist rank captures; an officer saying "agreed
 * Are gets the next one" is a decision. Ranking them against each other
 * automatically was the thing we chose NOT to do, so the app records who said
 * what and lets the council read it.
 */
export const ITEM_COMMENT_VOICES = ["raider", "officer"] as const;
export type ItemCommentVoice = (typeof ITEM_COMMENT_VOICES)[number];

export const ITEM_COMMENT_VOICE_LABELS: Record<ItemCommentVoice, string> = {
  raider: "Raider",
  officer: "Officer",
};

export const ITEM_COMMENT_VOICE_VARIANT: Record<ItemCommentVoice, "secondary" | "success"> = {
  raider: "secondary",
  officer: "success",
};
