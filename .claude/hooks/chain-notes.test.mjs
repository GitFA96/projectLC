import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CHAIN_NOTES, chainNoteFor, editedFile } from "./chain-notes.mjs";

/**
 * A chain note is a prompt, so the bar is different from a guard's: firing when
 * it need not is a wasted line, and staying silent is the failure. What is
 * tested here is that each note reaches its file, that a note never fires on
 * something unrelated, and — the part that rots — that every file it names
 * still exists.
 */

const root = path.resolve(import.meta.dirname, "../..");
const p = (...parts) => path.join("src", ...parts);

describe("chainNoteFor", () => {
  it("fires on the curated WCL lists, with the re-import in it", () => {
    for (const file of [p("lib", "wcl", "consumables.ts"), p("lib", "wcl", "class-tracks.ts")]) {
      const note = chainNoteFor(file);
      expect(note, file).toMatch(/re-import/i);
      expect(note, file).toMatch(/server-side/i);
    }
  });

  it("takes an absolute Windows path as readily as a repo-relative one", () => {
    // The hook is handed whatever the tool used, and on this machine that is a
    // backslashed absolute path.
    const win = "C:\\Users\\x\\projectLC\\src\\lib\\wcl\\consumables.ts";
    expect(chainNoteFor(win)).toMatch(/re-import/i);
    expect(chainNoteFor("/home/x/projectLC/src/lib/wcl/consumables.ts")).toMatch(/re-import/i);
  });

  it("names the migration step on any edit to the schema or the migrations", () => {
    // Before B2 both lived in a 4,000-line `db.ts` and the note had to be
    // narrowed by what the edit contained, or it fired on every unrelated
    // change and taught the reader to skip it. They are two files of their own
    // now, so an edit to either is already about the schema.
    for (const file of ["schema.ts", "migrate.ts"]) {
      expect(chainNoteFor(p("lib", "data", "db", file)), file).toMatch(/COLUMN_MIGRATIONS/);
      expect(chainNoteFor(p("lib", "data", "db", file), "const x = 1;"), file).toMatch(
        /COLUMN_MIGRATIONS/,
      );
    }
    // And the barrel is not the schema.
    expect(chainNoteFor(p("lib", "data", "db.ts"), "CREATE TABLE IF NOT EXISTS x (")).toBe("");
    expect(chainNoteFor(p("lib", "data", "db", "rows.ts"))).toBe("");
  });

  it("names the silent step for policy and for capabilities", () => {
    expect(chainNoteFor(p("lib", "analysis", "policy.ts"))).toMatch(/sanitizePolicy/);
    const caps = chainNoteFor(p("lib", "auth", "capabilities.ts"));
    expect(caps).toMatch(/enforcement site/);
    expect(caps).toMatch(/NEVER_BASELINE/);
  });

  it("says nothing about a file in no chain", () => {
    for (const file of [
      p("components", "data-table.tsx"),
      p("lib", "sort.ts"),
      p("lib", "wcl", "normalize.ts"),
      "README.md",
      "",
    ]) {
      expect(chainNoteFor(file, "anything at all"), file).toBe("");
    }
  });

  it("survives a payload shaped in no way it expects", () => {
    // The hook must not throw: a PostToolUse crash would surface as a tool
    // failure on an edit that actually succeeded.
    for (const bad of [undefined, null, 42, {}, { tool_input: null }]) {
      expect(() => editedFile(bad)).not.toThrow();
    }
    expect(chainNoteFor(undefined)).toBe("");
    expect(chainNoteFor(null, null)).toBe("");
  });
});

describe("editedFile", () => {
  it("reads the file and text out of an Edit payload", () => {
    expect(
      editedFile({
        tool_input: { file_path: "src/lib/data/db.ts", new_string: "ADD COLUMN foo TEXT" },
      }),
    ).toEqual({ filePath: "src/lib/data/db.ts", text: "ADD COLUMN foo TEXT" });
  });

  it("reads a Write payload, and a multi-edit one", () => {
    expect(editedFile({ tool_input: { file_path: "a.ts", content: "x" } }).text).toBe("x");
    expect(
      editedFile({
        tool_input: { file_path: "a.ts", edits: [{ new_string: "one" }, { new_string: "two" }] },
      }).text,
    ).toBe("one\ntwo");
  });

  it("prefers the path the tool reported over the one it was asked for", () => {
    expect(
      editedFile({
        tool_input: { file_path: "asked.ts" },
        tool_response: { filePath: "actual.ts" },
      }).filePath,
    ).toBe("actual.ts");
  });
});

describe("the notes stay true", () => {
  it("gives every note a distinct id", () => {
    const ids = CHAIN_NOTES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /*
   * The half that rots. A note is prose about other files, and a rename makes it
   * confidently wrong — which is worse than absent, because it will be believed.
   */
  it("names only files that exist", () => {
    const named = CHAIN_NOTES.flatMap((n) => n.note.match(/[\w./-]+\.(ts|tsx|css|mjs)\b/g) ?? []);
    expect(named.length).toBeGreaterThan(4);
    const missing = named.filter(
      (f) =>
        !existsSync(path.join(root, f)) &&
        // Bare basenames are named the way a person would say them; find them anywhere.
        !existsSync(path.join(root, "src", f)) &&
        !hasBasename(f),
    );
    expect(missing, "a chain note names a file that no longer exists").toEqual([]);
  });
});

/**
 * Whether some file in the repo is called this.
 *
 * Notes name files the way a person would say them: sometimes a bare
 * `policy.ts`, sometimes enough of the path to disambiguate it from another
 * file with the same name — `db/meta/policy.ts` against `analysis/policy.ts`.
 * Both have to resolve, so a path is matched as a suffix of a real one.
 */
function hasBasename(name) {
  const roots = ["src/lib", "src/app", "src/components", ".claude/hooks", "scripts", "docs"];
  const stack = roots.map((r) => path.join(root, r));
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        stack.push(path.join(dir, entry.name));
        continue;
      }
      const full = path.join(dir, entry.name).split(path.sep).join("/");
      if (full.endsWith("/" + name) || entry.name === name) return true;
    }
  }
  return false;
}
