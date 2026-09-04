/**
 * The two things every PreToolUse hook here does: read the command off stdin,
 * and print a deny decision.
 *
 * Kept apart from `guard-checks.mjs` so that file stays a set of pure decisions
 * a test can import, and apart from the hooks themselves so a third one costs
 * five lines rather than another copy of the protocol.
 */

/**
 * The command the tool is about to run, or "" when there isn't one.
 *
 * Every failure path returns "" rather than throwing. A hook that crashes on a
 * payload it didn't expect would block every command in the session, which is a
 * far worse outcome than missing the one case it was watching for — so the
 * guards fail **open** by construction, and each one's caller exits quietly on
 * an empty string.
 */
export async function readCommand() {
  const raw = await new Promise((resolve) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (buf += c));
    process.stdin.on("end", () => resolve(buf));
    process.stdin.on("error", () => resolve(""));
  });

  try {
    const command = JSON.parse(raw)?.tool_input?.command;
    return typeof command === "string" ? command : "";
  } catch {
    return "";
  }
}

/** Refuse the command, telling the model why in enough detail to fix it. */
export function deny(reason) {
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
