# src/lib/import — parsers for pasted data

`sixtyupgrades.ts` (gear sets) · `gargul.ts` (loot pastes) · `schemas.ts` (the
zod gate) · `diff.ts` (what an update would change).

## Rules

- **`schemas.ts` is the only door into the database.** The same schemas validate
  the client-side preview, the server-side commit and the seed files. Server
  actions re-validate — never trust that the preview already did.
- **Parsers are built against real exports, not against the format docs.** The
  checked-in fixture (`__fixtures__/sixtyupgrades-fury-warrior.json`) is a real
  export. If you're changing parsing behaviour, add a real sample; a fixture you
  wrote from imagination proves the parser matches your imagination.
- **Be tolerant on input, strict on output.** Gargul's standard CSV is
  header-detected and read *by column name* (so the trailing award `id` can't be
  mistaken for the item), with header-less custom formats handled by shape.
  Unknown extra columns must not fail a paste.
- **Imports only ever fill gaps in the item cache.** Every field but the id is
  optional and merges per id, so a Gargul name, a log's icon and a Wowhead
  lookup compose instead of overwriting each other. Never let an import clobber
  a curated value.
- **Re-import is the update flow.** Importing over an existing set writes
  nothing until the caller confirms — the officer sees exactly which slots
  change first. Preserve that two-step; silent replacement loses data.

See [`docs/change-chains.md`](../../../docs/change-chains.md) §2, §8.
