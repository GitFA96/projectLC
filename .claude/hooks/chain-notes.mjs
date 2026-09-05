/**
 * The chain a file sits in, printed the moment the file is edited.
 *
 * `docs/change-chains.md` is the most valuable document here and the least
 * likely to be read at the right moment: an agent reads it before starting and
 * then edits `consumables.ts` forty minutes later, when the sentence about
 * re-importing has scrolled out of mind. These notes arrive with the edit.
 *
 * They are a **prompt, never a gate.** Every one names a step that fails
 * silently, and the whole value is remembering the second place — so a note
 * that is wrong or unwanted costs a line of context, and one that is missing
 * costs a raid night. Erring toward firing is deliberate.
 *
 * The rule for adding one: the second step must be invisible when skipped. A
 * coupling a test already catches does not belong here, because the test is a
 * better messenger.
 *
 * Pure so `chain-notes.test.mjs` can hold every case. `chain-hint.mjs` is the
 * CLI, and it fails open.
 */

/**
 * `when` narrows a note to edits that plausibly touch the coupling. Only worth
 * it for a file large enough that most edits have nothing to do with the chain
 * — `sqlite-repo.ts` is 2,000 lines and most of an edit to it is not a write.
 */
export const CHAIN_NOTES = [
  {
    id: "wcl-curated-lists",
    match: /src[/\\]lib[/\\]wcl[/\\](consumables|class-tracks)\.ts$/,
    note:
      "change-chains §1 — the WCL events fetch is filtered SERVER-SIDE from these lists " +
      "(via src/lib/wcl/event-filters.ts). A report imported before an id was added never " +
      "contained the event and never will. So: adding an id without re-importing is a no-op " +
      "that reviews as correct and reports zero uses forever. **Tell the officer to re-import.** " +
      "Never add an id or aura name from memory — probe a real log (skill: probe-wcl).",
  },
  {
    id: "schema",
    // Since B2 these are two files of their own, so an edit to either is
    // already about the schema — no `when` needed to keep the note relevant.
    match: /src[/\\]lib[/\\]data[/\\]db[/\\](schema|migrate)\.ts$/,
    note:
      "change-chains §2 — a column added to SCHEMA alone works on every machine except the " +
      "user's: CREATE TABLE IF NOT EXISTS never retrofits an existing database. Add an entry " +
      "to COLUMN_MIGRATIONS (or POST_REBUILD_COLUMN_MIGRATIONS for `items`). " +
      "migrations.test.ts fails until you do. A whole new TABLE needs neither.",
  },
  {
    id: "policy",
    match: /src[/\\]lib[/\\]analysis[/\\]policy\.ts$/,
    note:
      "change-chains §4b — a new policy field needs `sanitizePolicy` in db/meta/policy.ts to " +
      "name it, or it is silently dropped on read: the editor saves, the page reloads, the " +
      "value is back to its default with no error. Then policy-editor.tsx, then " +
      "policy.test.ts, which asserts the WHOLE default object — adopting a field must change " +
      "no number until an officer edits one.",
  },
  {
    id: "capabilities",
    match: /src[/\\]lib[/\\]auth[/\\]capabilities\.ts$/,
    note:
      "change-chains §11 — a capability with no enforcement site is a checkbox that protects " +
      "nothing, and the guild will believe it. enforcement.test.ts pins that set at empty. " +
      "Also: the role templates a guild starts from (a capability nobody's template holds " +
      "ships denied to every existing guild), and NEVER_BASELINE if it can hand out " +
      "capabilities.",
  },
  {
    id: "write-repo",
    match: /src[/\\]lib[/\\]data[/\\](repo|sqlite-repo)\.ts$/,
    when: /WriteRepo|bumpDataVersion|withTx/,
    note:
      "change-chains §4 — every write ends `bumpDataVersion(db)` in the data layer and " +
      "`refreshAfterWrite()` in the action. Two caches, two silent failures. A new WriteRepo " +
      "method must also be listed in write-contract.test.ts, in BUMPS or in NO_BUMP with the " +
      "argument for why not.",
  },
  {
    id: "colour-roles",
    match: /src[/\\]app[/\\]globals\.css$/,
    note:
      "root AGENTS.md invariant 7 — this is the only place that knows what a colour ROLE " +
      "looks like, and there are two themes. Components name the role (`bg-warn-soft`), " +
      "never the palette step. Check both themes before you are done.",
  },
];

/**
 * The notes for one edited file, joined, or "" when none apply.
 *
 * `text` is whatever the edit is writing — used only by the `when` narrowing.
 * Passing "" means "I don't know what changed", and a narrowed note then stays
 * silent rather than firing on every edit to a large file.
 */
export function chainNoteFor(filePath, text = "") {
  if (typeof filePath !== "string" || filePath === "") return "";
  const hits = CHAIN_NOTES.filter(
    (n) => n.match.test(filePath) && (!n.when || n.when.test(String(text))),
  );
  if (hits.length === 0) return "";
  return hits.map((n) => n.note).join("\n\n");
}

/**
 * The file an Edit/Write payload is about, and the text it is putting there.
 *
 * Shapes differ per tool and across versions, so every field is optional and a
 * miss returns empty strings — the hook then says nothing, which is the correct
 * failure for a prompt.
 */
export function editedFile(payload) {
  const input = payload?.tool_input ?? {};
  const filePath = payload?.tool_response?.filePath ?? input.file_path ?? "";
  const text = [input.new_string, input.content, ...(input.edits ?? []).map((e) => e?.new_string)]
    .filter((v) => typeof v === "string")
    .join("\n");
  return { filePath: typeof filePath === "string" ? filePath : "", text };
}
