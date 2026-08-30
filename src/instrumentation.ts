/**
 * Boot hook. Runs once per server instance, before any request is served.
 *
 * This file is bundled for **every** runtime, Edge included, so it must not
 * touch Node APIs directly — both things it does are reached through the
 * conditional dynamic import below.
 *
 * **`register` is exported for Next, not for us.** The framework calls it by
 * name, so nothing in `src/` imports it — which makes it the one export here
 * that looks unused to every dead-code scan and must stay exported anyway.
 *
 * The claim announcement is the visible one: an unclaimed deployment prints the
 * code that lets its owner take it, to the terminal, because that is the one
 * place a passer-by cannot read. Once anybody holds an account it goes quiet
 * forever.
 */
export async function register(): Promise<void> {
  // Node only. The edge runtime has no SQLite, and importing the data layer
  // there would fail the build rather than skip the log.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Quietens one Node warning; see the file for which and why. Before the
  // claim log, so booting is not the first thing to trigger it.
  await import("./instrumentation-node");
  // Deliberately NOT in a try/catch, unlike the claim log below: a production
  // deployment with authorization off is the one misconfiguration that must
  // stop the server rather than be survived. See the file for why there is no
  // override.
  const { assertAuthConfigured } = await import("@/lib/auth/boot");
  assertAuthConfigured();
  try {
    const { announceClaimCode } = await import("@/lib/auth/claim");
    announceClaimCode();
  } catch {
    // A boot-time convenience must never be the reason the server won't start.
  }
}
