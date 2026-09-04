/**
 * The decisions behind the session guards, as pure functions.
 *
 * Split out for the same reason `scripts/doctor-checks.mjs` is: a module that
 * both exports a function and runs a program on import cannot be imported by a
 * test without running the program. The hooks beside this file read stdin and
 * print a verdict; everything that decides *what* the verdict is lives here,
 * where `guard-checks.test.mjs` can ask it about a hundred commands in a
 * second.
 *
 * Every check returns a **reason string** to deny with, or `null` to allow.
 * None of them throw: a guard that crashes must fail open, because a broken
 * guard blocking every command is worse than the hazard it watches for.
 */

/** The one alternate dist dir AGENTS.md sanctions, and the one .gitignore covers. */
export const SANCTIONED_DIST = ".next-build";

/** The user's live guild data — root AGENTS.md invariant 1. */
export const LIVE_DB = "data/projectlc.db";

export const DEV_PORT = 3000;

/**
 * Windows and POSIX spell the same path two ways and the shell doesn't care
 * about case, so every comparison here happens on one normalized form. This is
 * deliberately not `path.normalize` — we are matching a substring inside a
 * command line, not resolving a real path, and half of these never exist.
 */
const normalize = (s) => s.replace(/\\/g, "/").toLowerCase();

/**
 * Remove heredoc bodies before matching anything.
 *
 * A heredoc body is *content*, not a command, and scanning it is how a guard
 * comes to refuse a document that merely quotes the thing it guards. That is
 * not hypothetical: writing `docs/improvement-plan.md` — a file whose whole
 * subject is these hooks — was denied twice, once for naming the dist-dir
 * variable inside prose and once for naming this file's own env var in a
 * memory note. Both were pure text being written to disk.
 *
 * The rule stays narrow: only a real `<<DELIM` body is stripped, and only up to
 * its closing delimiter. Ordinary quotes are left alone, because
 * `sqlite3 "data/projectlc.db" "DELETE …"` puts the dangerous half in quotes
 * too — stripping those would open the exact hole these guards exist to close.
 */
export function stripHeredocs(command) {
  let out = "";
  let rest = command;
  // <<EOF, <<-EOF, <<'EOF', <<"EOF" — the quoted forms only change expansion.
  const opener = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/;
  for (;;) {
    const m = rest.match(opener);
    if (!m) return out + rest;
    const delim = m[2];
    const afterOpener = m.index + m[0].length;
    out += rest.slice(0, afterOpener);
    // The body starts on the next line and ends at a line holding only the
    // delimiter (leading tabs allowed, which is what <<- is for).
    const body = rest.slice(afterOpener);
    const closer = new RegExp(`\\n[ \\t]*${delim}[ \\t]*(?=\\n|$)`);
    const end = body.match(closer);
    if (!end) return out; // Unterminated: the rest is all body, so drop it.
    rest = body.slice(end.index + end[0].length);
  }
}

/**
 * Split a command line into the pieces the shell would run separately.
 *
 * Needed because a guard that inspects only the first word is trivially
 * defeated by `cp data/projectlc.db /tmp/ && rm data/projectlc.db` — which
 * opens with a sanctioned copy and ends by destroying the guild's history.
 * Each segment is judged on its own.
 *
 * Quoting is deliberately ignored. Over-splitting a quoted `;` yields more
 * segments, each still checked, so the error is toward denying — which is the
 * safe direction for a guard.
 */
export function splitSegments(command) {
  return stripHeredocs(command)
    .split(/\s*(?:&&|\|\||[;|\n])\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The value of a `NEXT_DIST_DIR=` assignment anywhere in the command, or null.
 *
 * The character class is a conservative path charset rather than "anything up
 * to whitespace". The looser form captured the closing backtick of an inline
 * code span and denied a sentence for naming a dist dir that differed from the
 * sanctioned one by exactly one punctuation mark. A path token is letters,
 * digits and path punctuation; the moment something else appears, the value has
 * ended and the rest belongs to whatever wrote it.
 */
export function distDirOf(command) {
  const m = stripHeredocs(command).match(/NEXT_DIST_DIR\s*=\s*["']?([A-Za-z0-9._/\\-]+)/);
  return m ? m[1] : null;
}

/** A build going through npm (which runs the two guards) or straight to Next (which doesn't). */
const runsBuild = (segment) =>
  /(^|[;&|\s])(npm|pnpm|yarn|bun)\s+(run\s+)?build(\s|$)/.test(segment) ||
  /(^|[;&|\s])(npx\s+)?next\s+build(\s|$)/.test(segment);

const isBareNextBuild = (segment) => /(^|[;&|\s])(npx\s+)?next\s+build(\s|$)/.test(segment);

const startsDevServer = (segment) =>
  /(^|[;&|\s])(npm|pnpm|yarn|bun)\s+(run\s+)?dev(\s|$)/.test(segment) ||
  /(^|[;&|\s])(npx\s+)?next\s+dev(\s|$)/.test(segment);

/**
 * Whether this command's verdict depends on what is listening on :3000.
 *
 * The port probe costs a TCP connect with a timeout, and it runs in front of
 * every Bash call in the session. Asking only when a dev server or a build is
 * actually involved keeps that off the common path.
 */
export function needsPortCheck(command) {
  return splitSegments(command).some((s) => startsDevServer(s) || runsBuild(s));
}

/** An unsanctioned dist dir leaves its whole build output untracked in git status. */
export function checkDistDir(command) {
  const dist = distDirOf(command);
  if (dist === null || dist === SANCTIONED_DIST) return null;
  return (
    `NEXT_DIST_DIR=${dist} is not a dist dir this project uses. Only ` +
    `${SANCTIONED_DIST} is sanctioned (see AGENTS.md), and it is the only alternate ` +
    `.gitignore covers — any other name leaves its whole build output sitting in ` +
    `git status as untracked files.`
  );
}

/**
 * A second dev server corrupts the shared Turbopack/Tailwind cache and takes
 * both servers down with a CSS parse error that reads like a source bug.
 */
export function checkDevServer(command, portBusy) {
  if (!portBusy) return null;
  if (!splitSegments(command).some(startsDevServer)) return null;
  return (
    `Something is already answering on :${DEV_PORT}. Starting a second Next dev ` +
    `server corrupts the shared Turbopack/Tailwind cache and takes BOTH servers ` +
    `down with a CSS parse error that reads like a source bug. Reuse the running ` +
    `server, or ask the user to restart it — do not start your own.`
  );
}

/**
 * Two ways a build goes wrong, and neither announces itself.
 *
 * **A bare `next build` skips the guards.** `npm run build` is `next build`
 * plus `check-dynamic-routes.mjs` and `prune-standalone.mjs` — the two things
 * standing between a silent mistake and a published one, a prerendered page
 * that serves the roster to anonymous callers and a live database copied into
 * the image. Reaching past npm removes both, and the build still succeeds.
 *
 * **A build shares `.next` with the dev server.** It takes the running server
 * down with it, and not visibly: the server keeps answering top-level routes
 * and 404s every nested one, which reads as a routing bug and costs an hour.
 */
export function checkBuild(command, portBusy) {
  const segments = splitSegments(command);

  if (segments.some(isBareNextBuild)) {
    return (
      "`next build` on its own skips the two guards `npm run build` adds — " +
      "check-dynamic-routes.mjs, which fails if a page is prerendered (a page " +
      "rendered at build time had no viewer, so its capability check never ran), " +
      "and prune-standalone.mjs, which fails if a database survives into the " +
      "artifact. Both bugs shipped once. Run `npm run build`."
    );
  }

  if (!portBusy || !segments.some(runsBuild)) return null;
  if (distDirOf(command) === SANCTIONED_DIST) return null;

  return (
    `Something is answering on :${DEV_PORT}, and a build shares .next with the dev ` +
    `server — it will take that server down with it. The failure does not look ` +
    `like a build: the server keeps serving top-level routes and 404s every ` +
    `nested one, which reads as a routing bug. Build somewhere else with ` +
    `NEXT_DIST_DIR=${SANCTIONED_DIST}, or ask the user to stop the server first.`
  );
}

/** Strip leading `FOO=bar` assignments so the real command word is first. */
function commandWords(segment) {
  const words = segment.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i += 1;
  return words.slice(i);
}

const COPY_COMMAND = /^(cp|copy|copy-item)$/i;

/** Where a copy would land: PowerShell's named parameter, else the last argument. */
function destinationOf(words) {
  const named = words.findIndex((w) => /^-dest(ination)?$/i.test(w));
  if (named !== -1) return words[named + 1] ?? null;
  return words.length >= 3 ? words[words.length - 1] : null;
}

const mentionsLiveDb = (text) => normalize(text).includes(LIVE_DB);

/** `data/`, `./data/…` — anywhere under the directory holding the live database. */
const insideDataDir = (dest) => /(^|\/)data(\/|$)/.test(normalize(dest));

/**
 * The one sanctioned way to touch the live database: copy it somewhere else.
 *
 * Requires the destination to be outside `data/` and not the live file itself,
 * which is what separates taking a snapshot from restoring over the original.
 */
function isCopyOut(segment) {
  const words = commandWords(segment);
  if (words.length < 3 || !COPY_COMMAND.test(words[0])) return false;
  const dest = destinationOf(words);
  if (dest === null) return false;
  return !mentionsLiveDb(dest) && !insideDataDir(dest);
}

/**
 * Refuse any command that reaches for the live guild database.
 *
 * Root AGENTS.md invariant 1, and the only root invariant with nothing behind
 * it until now: `data/projectlc.db` is one guild's real history, the app's only
 * copy of it, and backups are still manual. Every other invariant in that file
 * fails a test when it is broken; this one fails a guild.
 *
 * It denies **reads** as well as writes, which is stricter than the invariant
 * and right for a second reason: the database runs in WAL mode, so recent
 * writes live in `projectlc.db-wal` until a checkpoint. A tool opening the
 * `.db` alone gets a file that opens cleanly, answers every query, and is
 * silently missing the newest rows — the worst possible way to be wrong about
 * real data. The copy this hook insists on is also the copy that is correct.
 *
 * A command line cannot be read for intent, so the rule is the other way round:
 * naming the file is refused, and the one workflow that must work — copying it
 * out to the scratchpad — is recognised explicitly.
 */
export function checkLiveDb(command) {
  const offending = splitSegments(command).find((s) => mentionsLiveDb(s) && !isCopyOut(s));
  if (!offending) return null;

  return (
    `That command names ${LIVE_DB}, which is the user's live guild data — real ` +
    `characters, awards and raid nights, with no automated backup (AGENTS.md ` +
    `invariant 1).\n\n` +
    `To check something against real data, copy it to the scratchpad and point ` +
    `PROJECTLC_DB at the copy:\n\n` +
    `  cp ${LIVE_DB} ${LIVE_DB}-wal ${LIVE_DB}-shm "$SCRATCH/"\n\n` +
    `Copy the -wal and -shm files with it. The database is in WAL mode, so the ` +
    `.db alone opens cleanly, answers every query, and is missing the newest ` +
    `rows — which is why reads are refused here too, not only writes.\n\n` +
    `Refused segment: ${offending}`
  );
}
