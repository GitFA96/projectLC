import type { WclReport } from "@/lib/types";

import { compareText } from "@/lib/sort";

/**
 * "Which nights would tell me something new if I re-imported them?"
 *
 * Everything a report says is fixed by the code that fetched it — a consumable
 * curated today is invisible in every report imported yesterday, and the app has
 * always looked perfectly healthy while under-counting. The rule was "tell the
 * officer to re-import", which put the whole burden on somebody remembering
 * which nights were affected.
 *
 * Each report now stores the auras its pulls carried that the tables couldn't
 * place. Ask the curated tables about those names again and the answer is a list
 * of reports worth re-fetching, with the reason attached.
 *
 * **Only auras that now classify as consumables count.** One later ruled a class
 * buff changes nothing measurable — re-importing would tidy the dump and move no
 * number — so flagging it would spend an officer's evening for nothing. Pure:
 * the classifier is passed in.
 */

export interface StaleReport {
  code: string;
  title: string;
  startTime: string;
  /** The auras this report saw that the app has since learned to place. */
  learned: { name: string; abilityId?: number; count: number; label: string; category: string }[];
  /** Pulls affected across those auras — the size of the correction. */
  pulls: number;
}

/**
 * Reports whose stored dump names something the tables now recognise.
 *
 * `classify` is `classifyAura` — taken as an argument so this stays pure and a
 * test can hand it a table of its own.
 */
export function findStaleReports(
  reports: WclReport[],
  classify: (name: string, abilityId?: number) => { category: string; label: string } | undefined,
): StaleReport[] {
  const stale: StaleReport[] = [];

  for (const report of reports) {
    const learned = report.unclassifiedAuras
      .map((aura) => {
        const hit = classify(aura.name, aura.abilityId);
        return hit ? { ...aura, label: hit.label, category: hit.category } : undefined;
      })
      .filter((x): x is StaleReport["learned"][number] => x !== undefined);

    if (learned.length === 0) continue;
    stale.push({
      code: report.code,
      title: report.title,
      startTime: report.startTime,
      learned,
      pulls: learned.reduce((sum, a) => sum + a.count, 0),
    });
  }

  // Biggest correction first: an aura seen at 40 pulls is worth an officer's
  // evening in a way one seen at 2 is not.
  return stale.sort((a, b) => b.pulls - a.pulls || compareText(a.code, b.code));
}
