import { rm } from "node:fs/promises";
import path from "node:path";
import { exists, findDatabases, leftoverReport } from "./standalone-checks.mjs";

/**
 * Keep the guild's database out of the deployable artifact, and fail the build
 * if it is still there.
 *
 * The CLI half: prune, then look. Why a build puts a database there at all, and
 * why the excludes config cannot stop it, is on `standalone-checks.mjs`.
 */
const dist = process.env.NEXT_DIST_DIR ?? ".next";
const standalone = path.join(dist, "standalone");

if (!(await exists(standalone))) {
  // Not a standalone build — nothing to do, and not an error.
  process.exit(0);
}

const runtimeData = path.join(standalone, "data");
if (await exists(runtimeData)) {
  await rm(runtimeData, { recursive: true, force: true });
  console.log(`pruned ${runtimeData} — runtime state, never build input`);
}

const report = leftoverReport(await findDatabases(standalone));
if (report) {
  console.error(report);
  process.exit(1);
}
