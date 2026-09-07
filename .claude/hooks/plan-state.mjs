/**
 * §7 of the improvement plan, counted.
 *
 * Split out of `session-brief.mjs` for the reason `chain-notes.mjs` was split
 * out of `chain-hint.mjs`: the hook itself is a top-level-await script with
 * side effects, and the only part of it that can be wrong *quietly* is this
 * parse. It has been wrong twice, both times by undercounting:
 *
 * 1. The first version wanted the state cell to read exactly `done`, which
 *    dropped the three rows carrying a parenthesis.
 * 2. The second counted `open` and `done` and nothing else, so a session began
 *    with "0 open, 32 done" while a row sat **in progress** — a briefing that
 *    was arithmetically true and told the reader the plan was finished.
 *
 * Both are the same failure: a row in a state the parse does not know about
 * disappears instead of being reported. `other` exists so the third one cannot.
 */

/**
 * §7's rows are `| id | item | state | notes |`, and its own header says a
 * state may carry a parenthesis — "done (commit)", "in progress (branch)",
 * "dropped (why)", so a state is matched by its start and not by the whole
 * cell. Anchored on the id cell, so prose elsewhere in the file that happens to
 * contain a pipe cannot be counted as a row.
 */
const ROW = /^\|\s*[A-E]\d+\s*\|[^|]*\|([^|]*)\|/gm;

const STATES = ["open", "in progress", "done", "dropped"];

/**
 * Counts §7's rows by state. Returns null when the text holds no rows at all —
 * the file moved or the table changed shape — because a confident "0 open,
 * 0 done" is worse than saying nothing.
 */
export function planCounts(text) {
  const cells = [...text.matchAll(ROW)].map((m) => m[1].trim().toLowerCase());
  if (cells.length === 0) return null;
  const counts = { open: 0, inProgress: 0, done: 0, dropped: 0, other: 0, total: cells.length };
  for (const cell of cells) {
    switch (STATES.find((state) => cell.startsWith(state))) {
      case "open":
        counts.open++;
        break;
      case "in progress":
        counts.inProgress++;
        break;
      case "done":
        counts.done++;
        break;
      case "dropped":
        counts.dropped++;
        break;
      default:
        counts.other++;
    }
  }
  return counts;
}

/**
 * The line the brief prints. Zero-valued states are left out so the common case
 * stays one short sentence, except `other`, which is always worth saying: it
 * means a row exists that this parse could not read.
 */
export function planLine(counts) {
  const parts = [`${counts.open} open`];
  if (counts.inProgress > 0) parts.push(`${counts.inProgress} in progress`);
  parts.push(`${counts.done} done`);
  if (counts.dropped > 0) parts.push(`${counts.dropped} dropped`);
  if (counts.other > 0) parts.push(`${counts.other} in a state this parse cannot read`);

  let advice;
  if (counts.open > 0) {
    advice = "Pick from there and update the row in the same commit.";
  } else if (counts.inProgress > 0) {
    // An in-progress row is usually waiting on something an agent cannot do —
    // D2 waits on a maintainer pushing a tag. Sending one to "pick from there"
    // would be sending it at a human's task.
    advice = "Nothing is open; the in-progress row says what it is waiting on.";
  } else {
    advice = "Every row is settled — read §8 and docs/backlog.md before starting something new.";
  }
  return `docs/improvement-plan.md §7: ${parts.join(", ")}. ${advice}`;
}
