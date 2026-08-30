import { rm, readdir, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Keep the guild's database out of the deployable artifact, and fail the build
 * if it is still there.
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
 * So the artifact is pruned instead, and then **checked**, because a cleanup
 * step that silently stops working is how this comes back.
 */
const dist = process.env.NEXT_DIST_DIR ?? ".next";
const standalone = path.join(dist, "standalone");

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function findDatabases(dir) {
  const hits = [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return hits; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) hits.push(...(await findDatabases(full)));
    else if (/\.db($|-wal$|-shm$)/.test(entry.name)) hits.push(full);
  }
  return hits;
}

if (!(await exists(standalone))) {
  // Not a standalone build — nothing to do, and not an error.
  process.exit(0);
}

const runtimeData = path.join(standalone, "data");
if (await exists(runtimeData)) {
  await rm(runtimeData, { recursive: true, force: true });
  console.log(`pruned ${runtimeData} — runtime state, never build input`);
}

const leftovers = await findDatabases(standalone);
if (leftovers.length > 0) {
  console.error(
    "\nRefusing to leave a database in the deployable artifact:\n" +
      leftovers.map((f) => `  ${f}`).join("\n") +
      "\n\nThis artifact may be pushed to a registry. Find what put it there " +
      "before shipping.\n",
  );
  process.exit(1);
}
