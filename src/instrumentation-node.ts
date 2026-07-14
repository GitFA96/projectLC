/**
 * Node-runtime boot code, loaded from instrumentation.ts via a conditional
 * dynamic import so the Edge bundle never sees these process APIs.
 *
 * Silences Node's ExperimentalWarning for node:sqlite — the warning fires when
 * src/lib/data/db.ts first loads and the Next dev overlay surfaces it as a
 * console error on every page. Only that one warning is swallowed; everything
 * else still reaches Node's default handler.
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
