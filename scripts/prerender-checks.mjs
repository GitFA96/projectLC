/**
 * Which routes a build prerendered, and why that is a security failure here.
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
 *
 * Pure: it takes the parsed manifest rather than reading one, so the tests can
 * hand it the shapes a real build produces without running a build. The CLI in
 * `check-dynamic-routes.mjs` does the reading and the exiting.
 *
 * **No shebang in this file** — see the note in `doctor-checks.mjs` for the
 * failure that causes.
 */

/**
 * Framework-internal prerenders. None of these render app data or consult a
 * capability, so none of them can leak one. Anything else appearing here is the
 * bug above coming back — widen this list only with an argument.
 */
export const FRAMEWORK = new Set(["/_global-error", "/favicon.ico", "/_not-found"]);

/**
 * The prerendered routes that are not framework internals.
 *
 * A manifest with no `routes` key is treated as "nothing prerendered", which is
 * what Next writes for a fully dynamic app. A manifest that cannot be read at
 * all is a different thing and the CLI refuses on it — an unreadable manifest
 * must never read as a clean bill of health.
 *
 * @param {{routes?: Record<string, unknown>}} manifest
 * @returns {string[]}
 */
export function prerenderedRoutes(manifest) {
  return Object.keys(manifest?.routes ?? {}).filter((r) => !FRAMEWORK.has(r));
}

/** What the operator is told when routes turn static. Empty for a clean build. */
export function prerenderReport(routes) {
  if (routes.length === 0) return "";
  return (
    "\nRefusing to ship prerendered pages:\n" +
    routes.map((r) => `  ${r}`).join("\n") +
    "\n\nA prerendered page was rendered at build time, when there was no " +
    "request and no viewer, so its capability check never ran. It will serve " +
    "that HTML to anyone.\n\nCheck that `export const dynamic = " +
    '"force-dynamic"` is still in src/app/layout.tsx.\n'
  );
}
