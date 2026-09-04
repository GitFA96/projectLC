import { describe, expect, it } from "vitest";
import { loadSeedStore } from "@/lib/data/seed-data";
import { createRepoFromStore } from "@/lib/data/store";
import type { Repo } from "@/lib/data/repo";

/**
 * What the app decides, frozen — so a refactor cannot quietly change it.
 *
 * Every other test here asks whether a function is correct. This one asks a
 * different question: **does the guild read the same way it did yesterday?**
 * Invariant 5 says the numbers that encode a judgement belong to the council,
 * and until now nothing noticed when a change moved one. A rename that drops a
 * tie-break, an extraction that reorders a filter, a "harmless" default — all
 * compile, all pass, and all can put a different raider at the top of the
 * standing board or a different name at the top of an item's contenders.
 *
 * So this renders the verdicts as a report and pins the report. A diff here is
 * never automatically a failure: it is either a bug or a decision, and the PR
 * has to say which. **Do not re-record it to make a build green.** Read the
 * diff, decide which it was, and say so in the change.
 *
 * ## Why the seed, and why a text report
 *
 * The seed roster is fictional (README says so) and committed, so it can live
 * in a snapshot where the real guild's data never could — and it runs through
 * the *same* `createRepoFromStore` as SQLite, which is the whole reason the
 * demo backend can't drift from the real one.
 *
 * The report is text rather than a JSON dump because a diff has to be readable
 * by whoever gets the PR. "Thrainn moved from 3rd to 1st" is a sentence someone
 * can rule on; forty changed lines of serialized objects is not.
 *
 * Stable by construction: the store is pure over committed fixtures, every sort
 * goes through `compareText`'s pinned "en" collator (`src/lib/sort.ts`), and
 * nothing below reads the clock. If this ever goes red without a code change,
 * one of those three stopped being true and *that* is the finding.
 */

const seedRepo = (): Repo => createRepoFromStore(loadSeedStore());

/**
 * The standing board, and the one deviation from DEFAULT_POLICY in this file.
 *
 * `roster.minRaids` is 3, and the seed ships **one** raid night — so under the
 * real default the board lists twelve raiders and places none of them. That is
 * the board working exactly as designed (a two-night trial does not belong at
 * the bottom of a replace list), and it would also make this snapshot worthless:
 * a file of blanks cannot notice a change in who ranks first.
 *
 * So the standing section alone drops the minimum to 1. Nothing else moves —
 * the weights stay 34/33/33, because a partial policy merges over the defaults
 * — and the report says so on its own face, so the numbers below can never be
 * read as the shipped default's output.
 *
 * The honest alternative is more seeded raid nights. That is a change to the
 * demo data every new install sees, which is a product decision rather than a
 * test fixture, so it stays out of this change.
 */
const PLACED_MIN_RAIDS = 1;
const placedRepo = (): Repo =>
  createRepoFromStore(loadSeedStore(), { policy: { roster: { minRaids: PLACED_MIN_RAIDS } } });

const pad = (s: string | number, n: number) => String(s).padEnd(n);
const num = (v: number | undefined, digits = 2) => (v === undefined ? "—" : v.toFixed(digits));

/**
 * Every primitive field of an object, sorted by key.
 *
 * Deliberately generic: a field added to a rollup shows up in the diff on its
 * own, which is the point — a new number that feeds a verdict should have to be
 * looked at once, not discovered later.
 */
function scalars(obj: object, indent = "  "): string {
  return Object.entries(obj)
    .filter(([, v]) => v === null || ["number", "string", "boolean"].includes(typeof v))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${indent}${pad(k, 28)} ${typeof v === "number" ? num(v) : String(v)}`)
    .join("\n");
}

describe("golden verdicts — the seed guild under DEFAULT_POLICY", () => {
  it("reads the same way it did last time", async () => {
    const repo = seedRepo();
    const out: string[] = [];
    const h = (title: string) => out.push("", `## ${title}`, "");

    out.push(
      "# Golden verdicts",
      "",
      "The seed guild, scored by DEFAULT_POLICY, rendered by src/lib/golden-verdicts.test.ts.",
      "A diff here is a bug or a decision — never a file to re-record. Read that file's header.",
    );

    // ---- Standing: who the board says to worry about, and in what order -----
    const standing = await placedRepo().getRosterStanding();
    for (const [board, side] of [
      ["mains", standing.mains],
      ["alts", standing.alts],
    ] as const) {
      h(`Roster standing — ${board}  (roster.minRaids=${PLACED_MIN_RAIDS}, see the test header)`);
      out.push(`pool ${side.pool} placed, ${side.unplaced} listed but unplaced`);
      out.push(`${pad("#", 4)}${pad("standing", 10)}${pad("band", 10)}${pad("measured", 10)}name`);
      side.rows.forEach((r, i) => {
        const note = r.unranked ? `  (unranked: ${r.unranked})` : "";
        out.push(
          `${pad(i + 1, 4)}${pad(num(r.standing), 10)}${pad(r.band ?? "—", 10)}${pad(r.measured, 10)}${r.name}${note}`,
        );
      });
      // The instrument, not the placings: a column where everyone sits within a
      // point separates nobody, and a change in its spread changes what the
      // board means even when the order holds.
      for (const d of side.distributions) {
        out.push(
          `  ${pad(d.key, 14)} median ${pad(num(d.median), 8)} range ${pad(
            `${num(d.min)}–${num(d.max)}`,
            16,
          )} spread ${pad(num(d.spread), 8)} measured ${d.measured}/${d.measured + d.missing}`,
        );
      }
    }

    // ---- Contention: the order the council reads names out in ---------------
    h("Most-contested items, and their contender order");
    const demand = await repo.listItemDemand();
    const contested = demand
      .filter((d) => d.openCount > 0)
      .sort((a, b) => b.openCount - a.openCount || a.itemId - b.itemId)
      .slice(0, 10);
    for (const d of contested) {
      out.push(`### ${d.name} (${d.itemId}) — ${d.openCount} open of ${d.wisherCount} wishing`);
      const c = await repo.getItemContention(d.itemId);
      if (!c) {
        out.push("  (no contention)");
        continue;
      }
      c.wishers.forEach((w, i) => {
        const tier = w.priorityTier === undefined ? "—" : `T${w.priorityTier}`;
        out.push(
          `  ${pad(i + 1, 4)}${pad(w.character.name, 16)}${pad(tier, 6)}` +
            `listRank ${pad(w.listRank, 4)}served ${pad(String(w.satisfied), 7)}` +
            `onSpecThisPhase ${w.onSpecAwardsActivePhase}`,
        );
      });
    }

    // ---- The loot plan, which is contention's order in raid order -----------
    h("Loot plan — Karazhan");
    const plan = await repo.getLootPlan("Karazhan");
    out.push(
      `contested ${plan.contestedCount} · served ${plan.servedCount} · unwanted ${plan.unwantedCount} · ` +
        `unmapped ${plan.unmappedCount} · sheet-only ${plan.sheetOnlyCount}`,
    );
    for (const boss of plan.bosses) {
      out.push(
        `  ${pad(boss.boss, 26)} items ${pad(boss.items.length, 5)} contested ${pad(
          boss.contestedCount,
          5,
        )} chains ${pad(boss.chainCount, 5)} sheet-only ${boss.sheetOnlyCount}`,
      );
    }

    // ---- The dashboard KPIs an officer reads first -------------------------
    h("Dashboard");
    const dash = await repo.getDashboard();
    out.push(scalars(dash));
    out.push(`  ${pad("contestedItems", 28)} ${dash.contestedItems.length}`);
    out.push(`  ${pad("bisWins.total", 28)} ${dash.bisWins.total}`);
    out.push(
      `  ${pad("fairness groups", 28)} ${dash.fairness
        .map((f) => `${f.phase}(${f.entries.length})`)
        .join(", ")}`,
    );

    // ---- Two raiders, end to end ------------------------------------------
    for (const slug of ["thrainn", "kazrak"]) {
      const perf = await repo.getCharacterPerformance(slug);
      h(`Performance — ${slug}`);
      if (!perf) {
        out.push("  (no performance record)");
        continue;
      }
      out.push(`  reports: ${perf.reports.length}`);
      // Both are optional until a report is imported, and "absent" is itself a
      // verdict worth pinning — a refactor that starts returning an empty
      // rollup instead of none would read as a raider with zero everything.
      out.push(perf.career ? scalars(perf.career) : "  (no career rollup)");
      out.push(perf.attendance ? scalars(perf.attendance, "  attendance.") : "  (no attendance)");
    }

    await expect(`${out.join("\n")}\n`).toMatchFileSnapshot("./__snapshots__/golden-verdicts.md");
  });

  /*
   * The snapshot above is only evidence while it actually contains verdicts.
   * An empty seed, a renamed getter returning nothing, or a board that silently
   * stopped placing anyone would all produce a stable, green, worthless file —
   * so the shape is asserted separately from the content.
   */
  it("is built from a seed that actually produces verdicts", async () => {
    const repo = seedRepo();
    const standing = await placedRepo().getRosterStanding();
    const placed = standing.mains.rows.filter((r) => r.standing !== undefined);

    expect(placed.length, "nobody is placed on the mains board — the snapshot proves nothing").toBeGreaterThan(2);
    expect((await repo.listItemDemand()).filter((d) => d.openCount > 0).length).toBeGreaterThan(5);
    expect((await repo.getLootPlan("Karazhan")).bosses.length).toBeGreaterThan(3);
  });

  /*
   * The deviation above is only safe while it is the *only* one. A second
   * override slipped into `placedRepo` — a weight, a coverage bar — would make
   * the snapshot describe a policy nobody runs, while still looking like the
   * guild's own board.
   */
  it("changes nothing in the policy but the raid minimum", async () => {
    const shipped = await seedRepo().getGuildPolicy();
    const placed = await placedRepo().getGuildPolicy();

    expect(placed).toEqual({
      ...shipped,
      roster: { ...shipped.roster, minRaids: PLACED_MIN_RAIDS },
    });
  });
});
