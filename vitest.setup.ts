/**
 * Test-run setup. Loaded by every worker (`setupFiles` in vitest.config.ts).
 *
 * Silences Node's ExperimentalWarning for node:sqlite, which fires the first
 * time src/lib/data/db.ts loads in a process. Vitest runs a pool of workers and
 * most of them open a database, so a clean run printed it fifteen times — four
 * lines of stack-trace advice each, interleaved with the reporter's own output.
 * A green run that looks alarming teaches you to skim the run, which is the
 * failure worth avoiding: the next real warning scrolls past unread.
 *
 * The app does the same thing in src/instrumentation-node.ts, for the same
 * reason and by the same means. Two copies rather than one shared module
 * because that file is bundled into the server build and this one must not be —
 * and a warning filter is small enough that a shared import would cost more
 * than it saves. If a third caller ever wants it, extract then.
 *
 * **Only this one warning is swallowed.** Everything else — every other
 * ExperimentalWarning, every deprecation, anything a test itself emits —
 * reaches Node's default handler untouched. A filter that took a category
 * would eventually hide something worth reading.
 */
const originalEmit = process.emit.bind(process);

process.emit = ((event: string, ...args: unknown[]) => {
  const warning = args[0];
  if (
    event === "warning" &&
    warning instanceof Error &&
    warning.name === "ExperimentalWarning" &&
    warning.message.includes("SQLite")
  ) {
    return false;
  }
  return (originalEmit as (...emitArgs: unknown[]) => boolean)(event, ...args);
}) as typeof process.emit;

export {};
