#!/usr/bin/env node
/**
 * Refuse any command that reaches for the user's live guild database.
 *
 * `data/projectlc.db` is root AGENTS.md invariant 1, and it was the only one of
 * the seven with nothing enforcing it. The others each fail a test when broken:
 * a missed `bumpDataVersion` fails the write contract, an ungated page fails
 * `pages.test.ts`, a bare `localeCompare` fails `sort.test.ts`. This one fails
 * a guild — one real council's characters, awards and raid nights, in a single
 * file, with backups still manual.
 *
 * A command line cannot be read for intent, so the rule runs the other way
 * round: naming the file is refused, and the one workflow that has to keep
 * working — copying it out to the scratchpad — is recognised explicitly.
 * `checkLiveDb` in `guard-checks.mjs` has the reasoning and the test.
 *
 * Any failure here exits silently — a broken guard must not block the session.
 */
import { readCommand, deny } from "./hook-io.mjs";
import { checkLiveDb } from "./guard-checks.mjs";

const command = await readCommand();
if (command.trim() === "") process.exit(0);

const reason = checkLiveDb(command);
if (reason) deny(reason);
