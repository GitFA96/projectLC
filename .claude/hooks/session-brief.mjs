#!/usr/bin/env node
/**
 * Two facts worth knowing before the first command of a session.
 *
 * **Is :3000 up.** It decides whether a build has to go to `.next-build`, and
 * getting that wrong takes the dev server down in a way that does not look like
 * it: the server keeps answering top-level routes and 404s every nested one,
 * which reads as a routing bug and costs an hour. Discovering it at the moment
 * the build is typed is too late — `guard-dev-server.mjs` catches that case,
 * but knowing up front is what stops the wasted attempt.
 *
 * **How much of the plan is open.** `docs/improvement-plan.md` §7 is where work
 * is picked and recorded, and a session that does not know it exists re-derives
 * it. One number is enough to make it worth opening.
 *
 * Fails open in every direction: any error, any missing file, any surprise, and
 * this prints nothing and exits 0. A session must never fail to start because
 * a briefing could not be produced.
 */
import { readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { DEV_PORT } from "./guard-checks.mjs";

/** Resolves true/false, never rejects; a short timeout so startup is not held up. */
function portIsOpen(port, timeoutMs = 300) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function planState(root) {
  const text = await readFile(path.join(root, "docs/improvement-plan.md"), "utf8");
  /*
   * §7's rows are `| id | item | state | notes |`, and its own header says a
   * state may carry a parenthesis — "done (commit)", "in progress (branch)",
   * "dropped (why)". Matching the start of the cell rather than the whole of it
   * is what counts those; an earlier version wanted the cell to be exactly
   * "done" and quietly undercounted by three.
   *
   * Anchored on the row's id cell so prose elsewhere in the file that happens
   * to contain the word cannot be counted as a row.
   */
  const states = [...text.matchAll(/^\|\s*[A-E]\d+\s*\|[^|]*\|\s*([a-z]+)/gm)].map((m) => m[1]);
  const counts = {
    open: states.filter((s) => s === "open").length,
    done: states.filter((s) => s === "done").length,
  };
  return states.length > 0 ? { ...counts, total: states.length } : null;
}

try {
  const root = process.env.CLAUDE_PROJECT_DIR ?? ".";
  const [up, plan] = await Promise.all([
    portIsOpen(DEV_PORT),
    planState(root).catch(() => null),
  ]);

  const lines = [
    up
      ? `The dev server is answering on :${DEV_PORT}. Build into \`.next-build\` ` +
        "(`NEXT_DIST_DIR=.next-build npm run build`) — a plain build shares `.next` and takes " +
        "it down, and the symptom is 404s on nested routes rather than an error."
      : `Nothing is listening on :${DEV_PORT}, so \`npm run build\` is safe as it stands.`,
  ];
  if (plan) {
    lines.push(
      `docs/improvement-plan.md §7: ${plan.open} open, ${plan.done} done. Pick from there ` +
        "and update the row in the same commit.",
    );
  }

  process.stdout.write(
    JSON.stringify({
      suppressOutput: true,
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: lines.join("\n"),
      },
    }),
  );
} catch {
  process.exit(0);
}
