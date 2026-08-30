import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Fail the build if any page is prerendered.
 *
 * This is a security check wearing a build check's clothes. `resolveViewer()`
 * short-circuits to `unrestrictedViewer()` when `PROJECTLC_AUTH` is off, and
 * that path never touches `cookies()` — so with no dynamic API in sight, Next
 * prerenders the page **at build time as a viewer holding every capability**
 * and serves that HTML to everyone. The request-time check cannot refuse a
 * request that never arrives.
 *
 * It hid behind `.env.local`: a workstation build has the flag set, marks every
 * route dynamic and looks perfectly healthy. A container build excludes
 * `.env.local` — as it must — and on 30 Aug 2026 fourteen capability-gated
 * routes turned static, `/roster` serving the entire roster to anonymous
 * callers.
 *
 * `export const dynamic = "force-dynamic"` in the root layout is the fix. This
 * is what notices when something removes it, or when a future page opts back
 * out on its own.
 */

/**
 * Framework-internal prerenders. None of these render app data or consult a
 * capability, so none of them can leak one. Anything else appearing here is the
 * bug above coming back — widen this list only with an argument.
 */
const FRAMEWORK = new Set(["/_global-error", "/favicon.ico", "/_not-found"]);

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

const prerendered = Object.keys(manifest.routes ?? {}).filter((r) => !FRAMEWORK.has(r));

if (prerendered.length > 0) {
  console.error(
    "\nRefusing to ship prerendered pages:\n" +
      prerendered.map((r) => `  ${r}`).join("\n") +
      "\n\nA prerendered page was rendered at build time, when there was no " +
      "request and no viewer, so its capability check never ran. It will serve " +
      "that HTML to anyone.\n\nCheck that `export const dynamic = " +
      '"force-dynamic"` is still in src/app/layout.tsx.\n',
  );
  process.exit(1);
}
