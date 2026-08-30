#!/usr/bin/env node
/**
 * CLI for the deployment checks.
 *
 * The checks live in doctor-checks.mjs, which is pure and has no top-level side
 * effects. This file is the part that reads the real environment and sets an
 * exit code — split out because a module that both exports a function and runs
 * a program on import cannot be imported by a test without running the program.
 */
import { runChecks } from "./doctor-checks.mjs";

const { errors, warnings, notes } = runChecks(process.env, process.version);
const mode = process.env.NODE_ENV ?? "development";

console.log(`projectLC doctor — ${mode}, Node ${process.version}\n`);

if (mode !== "production") {
  // Otherwise the warnings below read as real gaps on a workstation, where
  // .env.local supplies half of them. This reads the process environment
  // because that is what a host injects; Next additionally loads .env* files
  // itself — exactly the difference that hid the prerender bug.
  console.log(
    "  note  Reads the process environment only. Next also loads .env* at runtime,\n" +
      "        so locally some of the below may already be set in .env.local.\n",
  );
}

for (const n of notes) console.log(`  note  ${n}\n`);
for (const w of warnings) console.log(`  WARN  ${w}\n`);
for (const e of errors) console.error(` ERROR ${e}\n`);

if (errors.length === 0) {
  console.log(`OK — ${warnings.length} warning(s), ${notes.length} note(s).`);
} else {
  console.error(`FAILED — ${errors.length} error(s) must be fixed before this deployment is safe.`);
  process.exit(1);
}
