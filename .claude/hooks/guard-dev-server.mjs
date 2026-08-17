#!/usr/bin/env node
/**
 * Refuse a second Next dev server, and any dist dir this project does not use.
 *
 * Both rules exist because of the same incident: a second `next dev` was started
 * while one was already running, the two Turbopack processes corrupted the
 * shared Tailwind cache, and **both** servers began returning 500 on every page
 * with a CSS parse error that looks nothing like its cause. The second server
 * also wrote to a dist dir `.gitignore` had never heard of, leaving 368
 * untracked files behind.
 *
 * Neither failure announces itself as "you started two servers", which is what
 * makes them worth a hook rather than a note in a doc.
 *
 * Reads the PreToolUse payload on stdin; prints a deny decision or nothing.
 * Any parse failure exits silently — a broken guard must not block the session.
 */
import { createConnection } from "node:net";

/** The one alternate dist dir AGENTS.md sanctions, and the one .gitignore covers. */
const SANCTIONED_DIST = ".next-build";
const DEV_PORT = 3000;

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

const raw = await new Promise((resolve) => {
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => (buf += c));
  process.stdin.on("end", () => resolve(buf));
  process.stdin.on("error", () => resolve(""));
});

let command = "";
try {
  command = JSON.parse(raw)?.tool_input?.command ?? "";
} catch {
  process.exit(0);
}
if (typeof command !== "string" || command.trim() === "") process.exit(0);

// A dist dir nothing ignores is how build output ends up in `git status`.
const dist = command.match(/NEXT_DIST_DIR\s*=\s*["']?([^\s;|&"']+)/);
if (dist && dist[1] !== SANCTIONED_DIST) {
  deny(
    `NEXT_DIST_DIR=${dist[1]} is not a dist dir this project uses. Only ` +
      `${SANCTIONED_DIST} is sanctioned (see AGENTS.md), and it is the only alternate ` +
      `.gitignore covers — any other name leaves its whole build output sitting in ` +
      `git status as untracked files.`,
  );
}

const startsDevServer =
  /(^|[;&|\s])(npm|pnpm|yarn|bun)\s+(run\s+)?dev(\s|$)/.test(command) ||
  /(^|[;&|\s])(npx\s+)?next\s+dev(\s|$)/.test(command);
if (!startsDevServer) process.exit(0);

/*
 * A TCP connect rather than an HTTP request: a dev server wedged into 500s is
 * still a dev server, and it is precisely the wedged case this guard exists to
 * stop you from compounding.
 */
const portBusy = await new Promise((resolve) => {
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

if (portBusy) {
  deny(
    `Something is already answering on :${DEV_PORT}. Starting a second Next dev ` +
      `server corrupts the shared Turbopack/Tailwind cache and takes BOTH servers ` +
      `down with a CSS parse error that reads like a source bug. Reuse the running ` +
      `server, or ask the user to restart it — do not start your own.`,
  );
}
