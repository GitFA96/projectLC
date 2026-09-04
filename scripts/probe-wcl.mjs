import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * Ask Warcraft Logs one question and write the answer to a file.
 *
 * Exists because **you must not invent what a log contains** (root AGENTS.md
 * invariant 4). Every claim about a spell id, an aura name or what an event
 * stream actually carries has to come from a real report, and guessing is how
 * a curated list gains an entry that collects nothing for ever.
 *
 * Deliberately standalone: it re-implements the twenty lines of OAuth in
 * `src/lib/wcl/client.ts` rather than importing it, so it still runs when the
 * app does not compile — which is often exactly when you need to ask.
 *
 * Usage:
 *   node scripts/probe-wcl.mjs <code|url> --events Casts --fights 1,2 --out x.json
 *   node scripts/probe-wcl.mjs <code|url> --query my.graphql --var limit=100
 *   node scripts/probe-wcl.mjs <code|url> --overview
 *
 * Credentials come from the environment, or from `.env.local` if it is there.
 */

const TOKEN_URL = process.env.WCL_TOKEN_URL ?? "https://www.warcraftlogs.com/oauth/token";
const API_URL = process.env.WCL_API_URL ?? "https://www.warcraftlogs.com/api/v2/client";

/** `.env.local` is what a workstation actually keeps the credentials in. */
async function loadEnvLocal() {
  let text;
  try {
    text = await readFile(".env.local", "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const value = m[2].trim().replace(/^["']|["']$/g, "");
    process.env[m[1]] ??= value;
  }
}

function parseArgs(argv) {
  const out = { positional: [], vars: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      out.positional.push(a);
    } else if (a === "--var") {
      const [k, ...rest] = argv[++i].split("=");
      const raw = rest.join("=");
      try {
        out.vars[k] = JSON.parse(raw);
      } catch {
        out.vars[k] = raw;
      }
    } else {
      const key = a.slice(2);
      const next = argv[i + 1];
      out[key] = next && !next.startsWith("--") ? argv[++i] : true;
    }
  }
  return out;
}

/** A report code out of a pasted URL, or a bare code. Mirrors extractReportCode. */
function reportCode(input) {
  const fromUrl = /reports\/(?:[a-z]+-)?([a-zA-Z0-9]{10,32})/.exec(input ?? "");
  if (fromUrl) return fromUrl[1];
  return /^[a-zA-Z0-9]{10,32}$/.test(input ?? "") ? input : undefined;
}

async function token() {
  const id = process.env.WCL_CLIENT_ID;
  const secret = process.env.WCL_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error("Set WCL_CLIENT_ID and WCL_CLIENT_SECRET (or put them in .env.local).");
  }
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Token request failed: HTTP ${res.status}`);
  const body = await res.json();
  if (!body.access_token) throw new Error("Token response had no access_token.");
  return body.access_token;
}

async function query(gql, variables) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: gql, variables }),
  });
  if (!res.ok) throw new Error(`API returned HTTP ${res.status}`);
  const body = await res.json();
  // GraphQL errors carry the API's own wording, which is the ground truth when
  // the schema differs from what the app believes.
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join(" · "));
  return body.data;
}

const OVERVIEW = `
query Overview($code: String!) {
  reportData { report(code: $code) {
    title zone { name } startTime endTime
    fights(killType: Encounters) { id encounterID name kill startTime endTime }
    masterData { actors { id name type subType } }
  } }
}`;

/**
 * One page of events.
 *
 * `fightIDs` is the trap: scoping by `startTime`/`endTime` alone silently
 * includes trash, which for a full night is an order of magnitude more events
 * and several more pages. `useAbilityIDs: false` is the second — without it the
 * response carries ids and no names, and every probe about "what is this called"
 * comes back unanswerable.
 */
const EVENTS = `
query Events($code: String!, $dataType: EventDataType!, $startTime: Float!, $endTime: Float!,
             $filter: String, $hostility: HostilityType, $fightIDs: [Int], $limit: Int) {
  reportData { report(code: $code) {
    events(dataType: $dataType, startTime: $startTime, endTime: $endTime,
           filterExpression: $filter, hostilityType: $hostility, fightIDs: $fightIDs,
           limit: $limit, useAbilityIDs: false) {
      data nextPageTimestamp
    }
  } }
}`;

await loadEnvLocal();
const args = parseArgs(process.argv.slice(2));
const code = reportCode(args.positional[0]);
if (!code) {
  console.error(
    [
      "Give a Warcraft Logs report code or URL.",
      "",
      "  node scripts/probe-wcl.mjs <code|url>                       # overview",
      "  node scripts/probe-wcl.mjs <code|url> --events Casts        # boss pulls only",
      "        --filter 'ability.name IN (\"Battle Shout\")'          # double quotes",
      "        --fights 1,2 | --allFights | --hostility Enemies",
      "  node scripts/probe-wcl.mjs <code|url> --query my.graphql --var limit=100",
      "",
      "Credentials come from the environment, or from .env.local.",
      "Output goes to $SCRATCH unless --out says otherwise.",
    ].join("\n"),
  );
  process.exit(1);
}

let data;
let label;
if (args.query) {
  label = path.basename(String(args.query), ".graphql");
  data = await query(await readFile(String(args.query), "utf8"), { code, ...args.vars });
} else if (args.events) {
  label = `events-${args.events}`;
  const overview = await query(OVERVIEW, { code });
  const report = overview.reportData.report;
  const fightIDs = args.fights
    ? String(args.fights).split(",").map(Number)
    : args.allFights
      ? null
      : report.fights.map((f) => f.id);
  data = await query(EVENTS, {
    code,
    dataType: args.events,
    startTime: 0,
    endTime: report.endTime - report.startTime,
    // Names go in DOUBLE quotes: `ability.name IN ("Battle Shout")`. Single
    // quotes are read as an identifier and the expression errors or, worse,
    // quietly matches less than you asked for.
    filter: args.filter ? String(args.filter) : null,
    hostility: args.hostility ? String(args.hostility) : null,
    fightIDs,
    limit: Number(args.limit ?? 10000),
  });
} else {
  label = "overview";
  data = await query(OVERVIEW, { code });
}

const out = String(
  args.out ?? path.join(process.env.SCRATCH ?? ".", `wcl-${code}-${label}.json`),
);
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(data, null, 2));
console.log(`${out}  (${(JSON.stringify(data).length / 1024).toFixed(0)} KB)`);
