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
 * **How much of the plan is open.** `docs/improvement-plan.md` §7 is where a
 * plan's work is picked and recorded, and a session that does not know it
 * exists re-derives it. The counting is `plan-state.mjs`, which is testable and
 * has been wrong twice; what is left here is reading the file and printing the
 * line — or not: a plan with every row settled prints nothing, because root
 * `AGENTS.md` already says it is closed.
 *
 * Fails open in every direction: any error, any missing file, any surprise, and
 * this prints nothing and exits 0. A session must never fail to start because
 * a briefing could not be produced.
 */
import { readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { DEV_PORT } from "./guard-checks.mjs";
import { planCounts, planLine } from "./plan-state.mjs";

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
  return planCounts(await readFile(path.join(root, "docs/improvement-plan.md"), "utf8"));
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
  const planText = plan && planLine(plan);
  if (planText) lines.push(planText);

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
