import { readFile } from "node:fs/promises";
import path from "node:path";
import { prerenderReport, prerenderedRoutes } from "./prerender-checks.mjs";

/**
 * Fail the build if any page is prerendered.
 *
 * The CLI half: find the manifest, hand it to `prerenderedRoutes`, exit. What
 * this guard is actually protecting, and the day it was written for, is on
 * `prerender-checks.mjs`.
 */

const dist = process.env.NEXT_DIST_DIR ?? ".next";
const manifestPath = path.join(dist, "prerender-manifest.json");

let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, "utf8"));
} catch {
  console.error(
    `Cannot read ${manifestPath}. This check must run after a build — if the ` +
      "manifest moved, fix the check rather than deleting it.",
  );
  process.exit(1);
}

const report = prerenderReport(prerenderedRoutes(manifest));
if (report) {
  console.error(report);
  process.exit(1);
}
