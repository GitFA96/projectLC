import { revalidatePath } from "next/cache";

/**
 * Refresh the pages a write touches, without letting the refresh decide
 * whether the write succeeded.
 *
 * Every server action here follows the same shape: do the work, revalidate,
 * report. Calling revalidatePath() inside the action's try block breaks that —
 * a throw from the cache layer lands in the catch and the officer is told the
 * write failed, seconds after it committed. They then retry, and the ledger
 * gains a duplicate award (or a second raid session, or a doubled comment).
 *
 * The data is already saved by the time this runs, so a failed refresh is the
 * lesser problem: the page catches up on the next navigation. Use this instead
 * of revalidatePath() in any action that reports a result.
 */
export function refreshAfterWrite(path: string = "/", type?: "layout" | "page"): void {
  try {
    if (type) revalidatePath(path, type);
    else revalidatePath(path);
  } catch {
    // No request context, or the cache is unavailable — the write stands.
  }
}
