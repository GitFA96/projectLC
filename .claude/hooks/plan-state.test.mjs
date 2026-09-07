import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { planCounts, planLine } from "./plan-state.mjs";

/**
 * The brief only informs, so it cannot refuse anything wrongly — its failure
 * mode is the quiet one: a count that reads as true and is not. Both of this
 * parse's real bugs were rows silently vanishing, so most of what is asserted
 * here is that the states add up and that an unreadable row is *reported*
 * rather than skipped.
 */

const PLAN = path.join(import.meta.dirname, "../../docs/improvement-plan.md");

const row = (id, state) => `| ${id} | Some item | ${state} | a note |`;

describe("planCounts", () => {
  it("reads a state that carries a parenthesis", () => {
    // §7's own header says a state may be "done (commit)" or "in progress
    // (branch)". Demanding the cell read exactly `done` is the first bug this
    // parse had, and it undercounted by three.
    const counts = planCounts([row("A1", "done (abc1234)"), row("B2", "done")].join("\n"));
    expect(counts.done).toBe(2);
  });

  it("counts an in-progress row as in progress — not as open, and not as nothing", () => {
    const counts = planCounts([row("A1", "done"), row("D2", "in progress")].join("\n"));
    expect(counts).toMatchObject({ open: 0, inProgress: 1, done: 1, other: 0, total: 2 });
  });

  it("reports a row it cannot read instead of dropping it", () => {
    // The failure both earlier versions shared. A typo'd state must show up as
    // something, or §7 quietly shrinks.
    const counts = planCounts([row("A1", "done"), row("A2", "blocked on Wowhead")].join("\n"));
    expect(counts.other).toBe(1);
    expect(counts.open + counts.inProgress + counts.done + counts.dropped + counts.other).toBe(
      counts.total,
    );
  });

  it("counts dropped rows without calling them done", () => {
    const counts = planCounts([row("C9", "dropped (superseded by B6)")].join("\n"));
    expect(counts).toMatchObject({ dropped: 1, done: 0, total: 1 });
  });

  it("ignores prose that is not a row", () => {
    const text = [
      "States: `open` · `in progress (branch)` · `done (commit)` · `dropped (why)`.",
      "| Id | Item | State | Notes |",
      "|---|---|---|---|",
      row("A1", "done"),
      "See §4A1 | which mentions done | and open | in passing",
    ].join("\n");
    expect(planCounts(text).total).toBe(1);
  });

  it("says nothing rather than reporting an empty plan", () => {
    // A confident "0 open, 0 done" would read as a finished plan. If the table
    // moved or changed shape, the brief should print no line at all.
    expect(planCounts("# 7. State\n\nNo table here yet.\n")).toBeNull();
  });
});

describe("planLine", () => {
  it("sends an agent to §7 when something is open", () => {
    const line = planLine(planCounts([row("A1", "open"), row("A2", "done")].join("\n")));
    expect(line).toMatch(/1 open, 1 done/);
    expect(line).toMatch(/Pick from there/);
  });

  it("does not send an agent at a row that is waiting on a person", () => {
    // D2 sat in progress until a maintainer pushed the tag. "Pick from there"
    // was the wrong instruction for that, and "0 open, 32 done" — what this
    // line used to say — was the wrong report.
    const line = planLine(planCounts([row("D2", "in progress"), row("A1", "done")].join("\n")));
    expect(line).toMatch(/1 in progress/);
    expect(line).not.toMatch(/Pick from there/);
    expect(line).toMatch(/waiting on/);
  });

  it("says nothing once every row is settled", () => {
    // A closed plan is not news: root AGENTS.md already says where to look
    // instead, and a line repeating it at every session start is the brief
    // teaching the reader to skip it. Dropped rows are settled too.
    const counts = planCounts([row("A1", "done"), row("A2", "dropped (why)")].join("\n"));
    expect(planLine(counts)).toBeNull();
  });

  it("always says when a row could not be read, and says to fix it", () => {
    const line = planLine(planCounts(row("A1", "waiting on the guild")));
    expect(line).toMatch(/1 in a state this parse cannot read/);
    expect(line).toMatch(/fix the row/);
  });

  it("leaves out the states that are zero", () => {
    const line = planLine(
      planCounts([row("A1", "open"), row("A2", "done"), row("A3", "done")].join("\n")),
    );
    expect(line).toMatch(/1 open, 2 done\./);
    expect(line).not.toMatch(/dropped|in progress|cannot read/);
  });
});

describe("the real §7", () => {
  it("still parses, and every row lands in a state the brief can name", () => {
    // The part that rots. If §7 is reworded into a shape this cannot read, the
    // brief goes quiet or undercounts, and nothing else in the suite notices.
    const counts = planCounts(readFileSync(PLAN, "utf8"));
    expect(counts, "docs/improvement-plan.md §7 no longer parses as a table of rows").not.toBeNull();
    expect(counts.total).toBeGreaterThan(20);
    expect(counts.other, "a §7 row is in a state the brief cannot report").toBe(0);
    expect(counts.open + counts.inProgress + counts.done + counts.dropped).toBe(counts.total);
  });
});
