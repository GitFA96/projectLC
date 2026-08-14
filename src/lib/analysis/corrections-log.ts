import type { ConsumableAdjustment } from "@/lib/types";
import { compareText } from "@/lib/sort";

/**
 * Every hand correction to a consumable count, across every raid, as one list.
 *
 * The gold estimate is inference and inference has edges, so officers correct
 * it — and a correction that only its author can find is not accountability.
 * This is the record: who changed what, for which raider, on which night, by
 * how much, and why. The raid page shows a night's corrections while you are
 * making them; this answers the questions that span nights, and "has anyone
 * been adjusting this raider" is the one it exists for.
 *
 * Deliberately not part of the governance audit log. That page records who
 * joined, who let them in and who changed what a role means — it says so — and
 * folding loot-adjacent judgement calls into the same stream would blur a
 * boundary somebody drew on purpose. Same page, its own tab, its own meaning.
 */
export interface CorrectionEntry {
  /** Report the correction belongs to. */
  code: string;
  /** Raid title, when the report is still stored. */
  raid?: string;
  /** Raid night, ISO — for ordering across reports. */
  raidAt?: string;
  /** The raider whose count was corrected. */
  actorName: string;
  /** Consumable corrected. */
  name: string;
  /** Uses added (+) or removed (-). */
  delta: number;
  /** Why, when the officer said. */
  note?: string;
  /** Who recorded it. Absent on corrections made before attribution existed. */
  by?: string;
  /** When it was recorded, ISO. */
  at: string;
}

export interface ReportStamp {
  code: string;
  title?: string;
  startedAt?: string;
}

/**
 * Flatten every report's corrections into one list, newest first.
 *
 * Sorted by when the correction was *made*, not by the night it corrects: the
 * question this answers is "what has been changed lately", and a correction to
 * a three-week-old raid is news the day somebody makes it. The raid it belongs
 * to is a column, and the filter.
 *
 * A correction whose report has since been deleted still appears, under its
 * bare code. Reports get re-imported and rebuilt; a record of a judgement call
 * that vanishes when its report does is not a record.
 */
export function correctionsLog(
  byCode: Record<string, ConsumableAdjustment[]>,
  reports: ReportStamp[],
): CorrectionEntry[] {
  const stamp = new Map(reports.map((r) => [r.code, r]));
  const out: CorrectionEntry[] = [];
  for (const [code, adjustments] of Object.entries(byCode)) {
    const report = stamp.get(code);
    for (const a of adjustments) {
      out.push({
        code,
        raid: report?.title,
        raidAt: report?.startedAt,
        actorName: a.actorName,
        name: a.name,
        delta: a.delta,
        note: a.note,
        by: a.by,
        at: a.at,
      });
    }
  }
  // `compareText` on the timestamps too — the locale cannot matter for an ISO
  // string, and the house rule is worth more as "always this" than as a
  // judgement re-made per call site. Its case-insensitivity is also what makes
  // the tiebreak stable: two spellings of one name tie, and a stable sort then
  // keeps them in the order they were recorded.
  return out.sort((x, y) => compareText(y.at, x.at) || compareText(x.actorName, y.actorName));
}

/** The raiders with corrections against them, for the filter. */
export function correctedRaiders(entries: CorrectionEntry[]): string[] {
  const seen = new Map<string, string>();
  for (const e of entries) {
    const key = e.actorName.trim().toLowerCase();
    if (!seen.has(key)) seen.set(key, e.actorName.trim());
  }
  return [...seen.values()].sort(compareText);
}

/** Case-insensitive, so a filter value from the URL matches however it was typed. */
export function filterByRaider(entries: CorrectionEntry[], raider?: string): CorrectionEntry[] {
  const slug = raider?.trim().toLowerCase();
  if (!slug) return entries;
  return entries.filter((e) => e.actorName.trim().toLowerCase() === slug);
}

/**
 * Who to hold responsible for a correction, and whether we actually know.
 *
 * Attribution is stamped on every write now, but corrections made before it
 * existed carry no author at all — and a blank where a name belongs reads as an
 * oversight rather than as the honest answer. So those say **Unknown**, plainly,
 * and `known` lets the UI mark them as a gap in the record rather than a person.
 *
 * A signed-out officer is a different case and deliberately not folded in here:
 * `actingOfficer` records the string "an officer" for those, which is a value
 * somebody wrote down, not a missing one. It shows as itself, the same way the
 * governance tab has always shown it.
 */
export function correctionAuthor(entry: { by?: string }): { name: string; known: boolean } {
  const by = entry.by?.trim();
  return by ? { name: by, known: true } : { name: "Unknown", known: false };
}

/** One save's worth of corrections — what an officer changed in a single sitting. */
export interface CorrectionBatch {
  code: string;
  raid?: string;
  raidAt?: string;
  by?: string;
  at: string;
  entries: CorrectionEntry[];
}

/**
 * Fold a save's corrections back into the one act they were.
 *
 * Corrections are buffered and written as a batch — an officer works down a
 * raider's consumables and saves once — so listing them flat turns one decision
 * into eight lines that scroll the rest of the log off the page. The record is
 * more truthful grouped: somebody sat down and corrected this night.
 *
 * The key is (report, author, timestamp), and it needs no new stored field
 * because a save already produces one: `attributeAdjustments` stamps every entry
 * it touched with the same `at`, computed once per write. Entries the save left
 * alone keep their original stamp and so stay with the batch that made them.
 *
 * Consecutive-only, which is safe because the input is sorted by `at`: two
 * separate sittings can't collapse into one just because they sort adjacently.
 * Group *after* filtering, so a chunk counts what is actually on screen.
 */
export function groupCorrections(entries: CorrectionEntry[]): CorrectionBatch[] {
  const out: CorrectionBatch[] = [];
  for (const entry of entries) {
    const last = out[out.length - 1];
    if (last && last.code === entry.code && last.at === entry.at && last.by === entry.by) {
      last.entries.push(entry);
      continue;
    }
    out.push({
      code: entry.code,
      raid: entry.raid,
      raidAt: entry.raidAt,
      by: entry.by,
      at: entry.at,
      entries: [entry],
    });
  }
  return out;
}
