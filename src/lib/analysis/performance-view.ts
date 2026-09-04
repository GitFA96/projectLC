import { elixirCoverage } from "@/lib/analysis/preparation";
import { compareText } from "@/lib/sort";
import type { WclPlayerFight } from "@/lib/types";

/**
 * The arithmetic behind a raider's performance page.
 *
 * These lived inside `characters/[name]/performance/page.tsx`, where nothing
 * could call them: a server component is not importable from a test. They are
 * the same functions, moved — the page is composition now, which is what
 * `docs/improvement-plan.md` B3 asked for.
 *
 * Every one is over a raider's **pull rows for one report**. The page decides
 * which rows those are (excused pulls are marked and kept, not dropped — see
 * `PerformanceReportView.excusedFightIds`); nothing here filters.
 */

/** `mm:ss` — pull lengths, where a raider reads minutes and not milliseconds. */
export function fmtDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

/**
 * The parse figure, or an em-dash.
 *
 * Absent is a real state and says so: a pull WCL never ranked has no amount,
 * and printing 0 would read as "did nothing" rather than "not measured".
 */
export function fmtAmount(row: Pick<WclPlayerFight, "amount" | "role">): string {
  if (row.amount === undefined) return "—";
  return `${Math.round(row.amount).toLocaleString("en-US")} ${row.role === "healer" ? "hps" : "dps"}`;
}

/**
 * What this raider had up, in the words the officer would use.
 *
 * A flask outranks everything — it is one item covering both halves — so a
 * flasked pull says only the flask. Without one the elixir pair is graded, and
 * the *missing* half is named: "Adept's Elixir — no guardian elixir" is a
 * sentence an officer can act on, where "partial" is not.
 */
export function consumableTitle(row: WclPlayerFight): string {
  if (row.flask !== undefined) return row.flask;
  const c = elixirCoverage(row);
  if (c.grade === "none") return "no flask or elixirs";
  const had = [c.battle, c.guardian, ...c.unclassified].filter(Boolean).join(" + ");
  if (c.missing === "guardianElixir") return `${had} — no guardian elixir`;
  if (c.missing === "battleElixir") return `${had} — no battle elixir`;
  return had;
}

/**
 * How many **pulls** each label appeared on, most-covered first.
 *
 * Deliberately not a count of uses: `new Set` per row, so a raider who drank
 * two of the same potion on one pull covered one pull with it. "On how many
 * pulls did they have this" and "how many did they get through" are different
 * questions, and `usesOf` answers the other one.
 */
export function coverage(
  rows: WclPlayerFight[],
  pick: (r: WclPlayerFight) => string[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const label of new Set(pick(row))) {
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return new Map([...counts].sort((a, b) => b[1] - a[1]));
}

/** Total uses per label — a potion can be drunk twice on a long pull. */
export function usesOf(
  rows: WclPlayerFight[],
  pick: (r: WclPlayerFight) => string[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const label of pick(row)) {
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return counts;
}

/** "Haste Potion ×3 · Super Sapper Charge" — most-used first, ties by name. */
export function countedList(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]))
    .map(([name, n]) => (n > 1 ? `${name} ×${n}` : name))
    .join(" · ");
}

/**
 * Average uptime per aura across a report, **weighted by pull length**.
 *
 * A plain mean would let a 40-second trash-adjacent pull count as much as a
 * nine-minute boss, so one bad opener on a short fight could sink a number that
 * describes the night. A raider whose aura was up all through the long fights
 * reads as having kept it up, because they did.
 */
export function upkeepAverages(rows: WclPlayerFight[]): Map<string, number> {
  const labels = [...new Set(rows.flatMap((r) => r.upkeep.map((u) => u.name)))];
  const totalDur = rows.reduce((s, r) => s + r.durationMs, 0);
  return new Map(
    labels
      .map((label): [string, number] => {
        const weighted = rows.reduce(
          (s, r) => s + (r.upkeep.find((u) => u.name === label)?.pct ?? 0) * r.durationMs,
          0,
        );
        return [label, Math.round(weighted / Math.max(1, totalDur))];
      })
      .sort((a, b) => b[1] - a[1]),
  );
}
