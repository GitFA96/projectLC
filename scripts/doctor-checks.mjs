/**
 * Every configuration mistake this deployment can make, as a check that fails
 * rather than a paragraph somebody has to remember.
 *
 * The deployment spec documents each of these. Prose is the wrong medium for
 * them: an operator — or an agent reading a runbook — takes in reason #3 and
 * forgets reason #7, and every one of these fails *silently*. A wrong `TZ`
 * renders raid times hours out and reads as a parsing bug. A missing
 * `PROJECTLC_AUTH` publishes the ledger. Neither says anything in a log.
 *
 * Pure: `runChecks()` takes the environment and the Node version as arguments
 * rather than reading globals, so the tests never mutate `process.env`. They are
 * required rather than defaulted for a second reason — Vite's `define` plugin
 * rewrites a bare `process.env`, and as a default parameter that produced a
 * syntax error the moment a test imported this file.
 *
 * Run it as `npm run doctor`, or inside the container before trusting it.
 *
 * **No shebang in this file.** It belongs on doctor.mjs, the executable. Node
 * strips a shebang from an imported module; Vite's parser does not, and the
 * failure is a bare "SyntaxError: Invalid or unexpected token" with no file and
 * no line number.
 */

/** Node floor. Below this the app crashes on node:sqlite rather than degrading. */
const NODE_FLOOR = [22, 13];

const CALLBACK_PATH = "/api/auth/discord/callback";

function parseNodeVersion(v) {
  const m = /^v?(\d+)\.(\d+)/.exec(v ?? "");
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/**
 * @returns {{errors: string[], warnings: string[], notes: string[]}}
 */
export function runChecks(env, nodeVersion) {
  const errors = [];
  const warnings = [];
  const notes = [];
  const production = env.NODE_ENV === "production";

  // --- Node floor -----------------------------------------------------------
  const v = parseNodeVersion(nodeVersion);
  if (!v) {
    warnings.push(`Could not parse the Node version (${nodeVersion}); wanted >=${NODE_FLOOR.join(".")}.`);
  } else if (v[0] < NODE_FLOOR[0] || (v[0] === NODE_FLOOR[0] && v[1] < NODE_FLOOR[1])) {
    errors.push(
      `Node ${v.join(".")} is below the ${NODE_FLOOR.join(".")} floor. ` +
        "node:sqlite is unflagged from 22.13; below that the app crashes on boot rather than degrading.",
    );
  }

  // --- Authorization --------------------------------------------------------
  if (production && env.PROJECTLC_AUTH !== "on") {
    errors.push(
      `PROJECTLC_AUTH is ${env.PROJECTLC_AUTH === undefined ? "unset" : JSON.stringify(env.PROJECTLC_AUTH)}, ` +
        'not "on". Every capability check passes while it is off, so this would serve the ledger, ' +
        "the audit log and the council's notes to anyone with the URL. The server refuses to boot like this.",
    );
  }

  // --- TLS hygiene ----------------------------------------------------------
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    errors.push(
      "NODE_TLS_REJECT_UNAUTHORIZED=0 disables certificate verification for every outbound HTTPS " +
        "call, including the Discord token exchange. Remove it from this environment.",
    );
  }

  // --- Data backend ---------------------------------------------------------
  if (production && env.DATA_BACKEND === "seed") {
    errors.push(
      'DATA_BACKEND=seed is a read-only demo: every write throws. Catastrophic on a real deployment. ' +
        "Unset it, or set it to sqlite.",
    );
  }

  // --- Database path --------------------------------------------------------
  const db = env.PROJECTLC_DB;
  if (production) {
    if (!db) {
      errors.push(
        "PROJECTLC_DB is unset, so the database defaults to <cwd>/data/projectlc.db — inside the " +
          "image on a container, which vanishes on redeploy. Point it at the mounted volume.",
      );
    } else if (!/^(\/|[A-Za-z]:[\/])/.test(db)) {
      errors.push(`PROJECTLC_DB must be an absolute path; got ${JSON.stringify(db)}.`);
    }
  }

  // --- Discord (the only way in) -------------------------------------------
  if (production) {
    for (const key of ["DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "DISCORD_REDIRECT_URI"]) {
      if (!env[key]) errors.push(`${key} is unset. Sign-in is Discord-only, so nobody can log in without it.`);
    }
    const uri = env.DISCORD_REDIRECT_URI;
    if (uri) {
      if (!uri.endsWith(CALLBACK_PATH)) {
        errors.push(
          `DISCORD_REDIRECT_URI must end with ${CALLBACK_PATH}; got ${JSON.stringify(uri)}. ` +
            "Discord matches it exactly and fails at its own consent screen, not yours.",
        );
      }
      if (uri.startsWith("http://") && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(uri)) {
        errors.push(`DISCORD_REDIRECT_URI is plain HTTP (${uri}). The session cookie is Secure in production.`);
      }
    }
  }

  // --- Timezone -------------------------------------------------------------
  if (production && (!env.TZ || env.TZ === "UTC")) {
    warnings.push(
      `TZ is ${env.TZ ? "UTC" : "unset"}. Timestamps render in process-local time while Warcraft Logs ` +
        "instants are stored as UTC, so a 19:30 CEST pull shows as 17:30. Set the guild's own zone, e.g. Europe/Oslo.",
    );
  }

  // --- Warcraft Logs (degrades, does not break) -----------------------------
  if (!env.WCL_CLIENT_ID || !env.WCL_CLIENT_SECRET) {
    warnings.push(
      "WCL_CLIENT_ID / WCL_CLIENT_SECRET are not both set. Log import and the fight graph will refuse " +
        "with a readable message; everything already imported keeps working.",
    );
  }

  // --- Claim code -----------------------------------------------------------
  if (env.PROJECTLC_CLAIM_CODE) {
    notes.push(
      "PROJECTLC_CLAIM_CODE is pinned. That is the friendlier install path — nobody has to read " +
        "container logs — but it is a second key to an unclaimed deployment. It stops meaning anything " +
        "the moment the deployment is claimed.",
    );
  }

  if (!env.WOWSIMCLI_PATH) {
    notes.push("WOWSIMCLI_PATH is unset. The sim pages will say so; nothing else is affected.");
  }

  return { errors, warnings, notes };
}
