#!/usr/bin/env node
/**
 * After an edit, say what else has to move.
 *
 * A `PostToolUse` hook on Edit|Write. It never blocks anything — the worst it
 * can do is add a paragraph of context — so every failure path here exits 0
 * with nothing printed. See `chain-notes.mjs` for the notes and the reasoning.
 */
import { chainNoteFor, editedFile } from "./chain-notes.mjs";

const raw = await new Promise((resolve) => {
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => (buf += c));
  process.stdin.on("end", () => resolve(buf));
  process.stdin.on("error", () => resolve(""));
});

let note = "";
try {
  const { filePath, text } = editedFile(JSON.parse(raw));
  note = chainNoteFor(filePath, text);
} catch {
  process.exit(0);
}
if (!note) process.exit(0);

process.stdout.write(
  JSON.stringify({
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: `Chain note for the file you just edited:\n\n${note}`,
    },
  }),
);
