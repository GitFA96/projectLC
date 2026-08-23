/**
 * Identity for a council note about a boss.
 *
 * A note is filed against a *drop source*, and a drop source is only unique
 * inside its raid: every zone has trash, so "Trash" alone would pool Mount
 * Hyjal's notes with Black Temple's. The boss half goes through `bossKey` so a
 * note written while the cache said "Illidari Council" is still found when the
 * plan headings say "The Illidari Council".
 *
 * Pure, and deliberately tiny — it exists so the writer and the reader cannot
 * disagree about what the key is, which is the way notes go missing.
 */

import { bossKey } from "@/lib/constants/wow";

/** The key a note is stored and looked up under. */
export function bossCommentKey(zone: string, boss: string): string {
  return `${zone.toLowerCase()}|${bossKey(boss)}`;
}
