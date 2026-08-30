/**
 * The one configuration mistake that must stop the server.
 *
 * `PROJECTLC_AUTH` fails **open**: unset, `authEnabled()` is false, every
 * capability check passes and every page renders for anyone who finds the URL.
 * That default is right for the history it protects — a deployment with no
 * accounts yet is the guild's live officer tool and must keep working — but on
 * a public host a typo in an env file publishes the ledger, the audit log and
 * the council's notes, and nothing in the build or the logs says a word.
 *
 * So in production it is not a default, it is a mistake, and the only safe
 * response to it is to refuse to boot.
 *
 * **There is deliberately no override.** The one case that looks like it needs
 * one — claiming a fresh deployment — does not: `/claim` is `pageView("public")`
 * and the claim code rides through sign-in in the OAuth state, so the callback
 * mints the first account and claims the deployment in a single pass with
 * enforcement on. An escape hatch here would only be used by the person who
 * should not be using it.
 *
 * Pure, and takes the environment as an argument, so a test never has to mutate
 * `process.env`.
 */
export function assertAuthConfigured(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;
  if (env.PROJECTLC_AUTH === "on") return;

  const seen = env.PROJECTLC_AUTH === undefined ? "unset" : JSON.stringify(env.PROJECTLC_AUTH);
  throw new Error(
    `PROJECTLC_AUTH must be "on" in production — it is ${seen}.\n\n` +
      "While it is off every capability check passes, so this deployment would " +
      "serve the loot ledger, the audit log and the council's notes to anyone " +
      "who finds the URL, with nothing in the logs to say so.\n\n" +
      'Set PROJECTLC_AUTH=on and start again. An unclaimed deployment still ' +
      "claims fine with it on: /claim is public and carries the code through " +
      "sign-in, so turning it off is never the fix.",
  );
}
