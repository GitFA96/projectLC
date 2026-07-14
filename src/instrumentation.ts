/**
 * Server-boot hook (runs once per runtime, before any request). Node-specific
 * work lives in instrumentation-node.ts behind a conditional dynamic import —
 * this file is bundled for every runtime (Edge included), so it must not
 * touch Node APIs directly.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
