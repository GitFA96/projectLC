#!/usr/bin/env node
/**
 * Refuse anything that would take the running dev server down, and any dist dir
 * this project does not use.
 *
 * The first two rules exist because of one incident: a second `next dev` was
 * started while one was already running, the two Turbopack processes corrupted
 * the shared Tailwind cache, and **both** servers began returning 500 on every
 * page with a CSS parse error that looks nothing like its cause. The second
 * server also wrote to a dist dir `.gitignore` had never heard of, leaving 368
 * untracked files behind.
 *
 * The build rules were added later and share the shape: `next build` writes to
 * the same `.next` the dev server is serving from, so a build run while one is
 * up kills it — and the corpse keeps answering top-level routes while 404ing
 * every nested one, which reads as a routing bug. A bare `next build` is
 * refused for an unrelated reason in the same family: it skips the two guards
 * `npm run build` wraps it in, both of which caught a bug that had already
 * shipped.
 *
 * None of these announce themselves as what they are, which is what makes them
 * worth a hook rather than a note in a doc. The decisions live in
 * `guard-checks.mjs`, where `guard-checks.test.mjs` can exercise them.
 *
 * Any failure here exits silently — a broken guard must not block the session.
 */
import { createConnection } from "node:net";
import { readCommand, deny } from "./hook-io.mjs";
import {
  DEV_PORT,
  checkBuild,
  checkDevServer,
  checkDistDir,
  needsPortCheck,
} from "./guard-checks.mjs";

/*
 * A TCP connect rather than an HTTP request: a dev server wedged into 500s is
 * still a dev server, and it is precisely the wedged case this guard exists to
 * stop you from compounding.
 */
function portBusy() {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port: DEV_PORT });
    const settle = (busy) => {
      socket.destroy();
      resolve(busy);
    };
    socket.setTimeout(1500);
    socket.on("connect", () => settle(true));
    socket.on("error", () => settle(false));
    socket.on("timeout", () => settle(false));
  });
}

const command = await readCommand();
if (command.trim() === "") process.exit(0);

// A dist dir nothing ignores is how build output ends up in `git status`, and
// the answer never depends on what is listening — so it is decided first, for
// free, before anything reaches for the network.
const distReason = checkDistDir(command);
if (distReason) deny(distReason);

const busy = needsPortCheck(command) ? await portBusy() : false;

const reason = checkDevServer(command, busy) ?? checkBuild(command, busy);
if (reason) deny(reason);
