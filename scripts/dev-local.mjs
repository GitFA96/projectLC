import { spawn } from "node:child_process";

/**
 * The dev server with enforcement off, reachable from this machine only.
 *
 * Two switches, and they belong together. `PROJECTLC_AUTH` off is the project's
 * own escape hatch — `resolveViewer()` returns `unrestrictedViewer()`, every
 * capability check passes, every page renders — which is what makes the app
 * readable to a browser with no Discord session, or to `curl`. On its own that
 * is fine. What is not fine is that `next dev` binds `0.0.0.0` by default, so
 * the same server that stops asking who you are is also answering the LAN: the
 * guild's ledger, the audit log and the council's notes, to anyone on the
 * network who finds the port.
 *
 * So this script never offers one without the other. Turning enforcement off is
 * the reason it exists; binding loopback is the price, and it is not
 * configurable here — pass `-H` to `npm run dev` if you genuinely want the
 * server on your network, which is the flavour that still asks for a login.
 *
 * Production is not a scenario this has to handle gracefully. `boot.ts` already
 * refuses to start with enforcement off there and has no override; the check
 * below is the same refusal one layer earlier, so the mistake is caught before
 * a server exists rather than by every route 500ing.
 */

if (process.env.NODE_ENV === "production") {
  console.error(
    "dev:local runs with PROJECTLC_AUTH off and NODE_ENV is production.\n\n" +
      "With enforcement off every capability check passes, so this would serve " +
      "the loot ledger, the audit log and the council's notes to anyone who " +
      "reaches it. Use `npm run dev` (or a real build) instead.",
  );
  process.exit(1);
}

const HOST = "127.0.0.1";
const port = process.env.PORT ?? "3000";

console.log(
  `\n  ⚠  auth OFF — every page renders as an unrestricted viewer` +
    `\n     bound to ${HOST} only, so nothing on your network can reach it` +
    `\n     http://localhost:${port}\n`,
);

/*
 * Empty rather than deleted: Next loads `.env.local` without overriding what is
 * already in `process.env`, and "already in" is by key, not by value. An empty
 * string is present, so it wins over the `PROJECTLC_AUTH=on` in that file —
 * `authEnabled()` compares against "on", so anything else is off.
 */
const child = spawn("npx", ["next", "dev", "-H", HOST, ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, PROJECTLC_AUTH: "" },
});

child.on("exit", (code, signal) => {
  // Mirror however the dev server went, so Ctrl-C reads as Ctrl-C.
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
