import { readdir, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Finding a database inside a deployable artifact.
 *
 * `output: "standalone"` copies every file Next's tracer believes a route
 * reaches. `defaultDbPath()` in src/lib/data/db.ts resolves to
 * `path.join(process.cwd(), "data", "projectlc.db")`, which the tracer follows
 * to the real file — so a plain build copies the **live database**, tens of MB
 * of real characters, awards and raid nights, into the directory you are about
 * to ship to a registry.
 *
 * `outputFileTracingExcludes` cannot fix it: its keys are *route* globs, and
 * the reference comes from `instrumentation.js`, which is not a route. Tried on
 * 30 Aug 2026 with both `/**` and `/*` keys — the file shipped anyway.
 *
 * So the artifact is pruned and then **checked**, because a cleanup step that
 * silently stops working is how this comes back. `prune-standalone.mjs` is the
 * CLI that does the pruning; the finding lives here so it can be run against a
 * tree built for the purpose.
 *
 * **No shebang in this file** — see the note in `doctor-checks.mjs`.
 */

/**
 * The three files one SQLite database is.
 *
 * `-wal` and `-shm` count: a WAL holds the newest writes, so shipping one
 * without its `.db` still ships guild data, and shipping a `.db` without its
 * WAL ships a stale copy of it. Matched on the extension rather than the name
 * because the file is only called `projectlc.db` by default — `PROJECTLC_DB`
 * can point anywhere, and the tracer follows whatever it points at.
 */
export const isDatabaseFile = (name) => /\.db($|-wal$|-shm$)/.test(name);

export async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Every database file under `dir`, recursively.
 *
 * A directory that cannot be read contributes nothing rather than throwing:
 * this runs over a tree Next generated, and a symlink or a permission oddity in
 * one corner of it must not stop the search finding a database in another.
 *
 * @returns {Promise<string[]>}
 */
export async function findDatabases(dir) {
  const hits = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return hits;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) hits.push(...(await findDatabases(full)));
    else if (isDatabaseFile(entry.name)) hits.push(full);
  }
  return hits;
}

/** What the operator is told when one survives the prune. Empty when none did. */
export function leftoverReport(files) {
  if (files.length === 0) return "";
  return (
    "\nRefusing to leave a database in the deployable artifact:\n" +
    files.map((f) => `  ${f}`).join("\n") +
    "\n\nThis artifact may be pushed to a registry. Find what put it there " +
    "before shipping.\n"
  );
}
