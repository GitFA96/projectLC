/**
 * What a fresh database is created with.
 *
 * Alone in its own file because it is one 690-line template literal and mixing
 * it with code makes both harder to read.
 */

/**
 * What a fresh database is created with, run on every boot.
 *
 * Every statement is `IF NOT EXISTS`, so this is also what gives an existing
 * database any table or index added since it was made. Columns are the
 * exception and need `COLUMN_MIGRATIONS` as well — see the comment there.
 *
 * Exported for `migrations.test.ts`, which builds databases missing one column
 * each and checks that opening the repo puts them back exactly as declared
 * here. Nothing else outside this file has any business reading it.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS guild (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  realm        TEXT NOT NULL,
  faction      TEXT NOT NULL,
  active_phase INTEGER NOT NULL,
  /* What this guild shows the world: 'private' | 'recruiting' | 'open'.
     Defaults closed, so a deployment upgrading into the public profile
     publishes nothing until somebody decides otherwise. Guild settings, NOT
     GuildPolicy -- policy is consumed by pure analysis functions and putting
     visibility there would drag authorization into the one layer whose value
     is having no idea who is asking (design doc section 6). */
  visibility   TEXT NOT NULL DEFAULT 'private',
  /* How long every owner may be quiet before the guild may appoint its own.
     NULL means the defaults in succession.ts. See section 7 of the design doc. */
  succession_admin_days  INTEGER,
  succession_member_days INTEGER
);
CREATE TABLE IF NOT EXISTS characters (
  id                TEXT PRIMARY KEY,
  guild_id          TEXT NOT NULL,
  name              TEXT NOT NULL COLLATE NOCASE UNIQUE,
  class             TEXT NOT NULL,
  spec              TEXT NOT NULL,
  role              TEXT NOT NULL,
  off_spec          TEXT,
  off_spec_role     TEXT,
  race              TEXT,
  status            TEXT NOT NULL,
  main_character_id TEXT,
  note              TEXT,
  /* Primary professions, as a JSON array of names. An owned list, same as a
     gear set's slots — '[]' is "nobody has said", not "they have none".
     Added after release — see migrate(). */
  professions_json  TEXT NOT NULL DEFAULT '[]',
  /* The membership that has claimed this character, if any. NULL is the normal
     state and stays supported: most characters are never claimed — raiders who
     never sign up, pugs who came once, and years of history belonging to people
     who left. Deleting a membership clears this; it never touches the character
     or its awards (invariant 6). Added after release — see migrate(). */
  membership_id     TEXT
);
-- Only the id is required: the cache is filled from whatever each import
-- knew (a Gargul link has a name, a log's gear snapshot only an icon) and
-- later sources fill the gaps in place. NULL means "not known yet".
CREATE TABLE IF NOT EXISTS items (
  id          INTEGER PRIMARY KEY,
  name        TEXT,
  quality     TEXT,
  icon        TEXT,
  slot        TEXT,
  source_json TEXT,
  phase       INTEGER,
  /* 1 once Wowhead answered for this id. See verifyItemProvenance() in
     migrate() — this table shipped without it, and every row in it was a
     guess nothing had checked. */
  verified    INTEGER NOT NULL DEFAULT 0,
  /* 1 when Wowhead files this id under its "Armor Tokens" subclass, 0 when it
     answered and it isn't one. NULL means nobody has asked — which is what
     the token backfill queues on. */
  armor_token INTEGER,
  /* For a tier piece: the armor token that buys it. See mergeTokenRedemptions. */
  redeems_from INTEGER,
  /* 1 once Wowhead has been asked about this id since the phase became
     something we read off its answer. Not the same as having a phase: most of
     TBC's launch items carry no phase tag at all, so "we asked and there was
     none" and "we never asked" are different states, and only the second is
     worth a request. See the STALE_PHASE tier in store/items.ts. */
  phase_checked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS gear_sets (
  id           TEXT PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES characters(id),
  kind         TEXT NOT NULL,
  phase        INTEGER,
  name         TEXT NOT NULL,
  source       TEXT NOT NULL,
  source_url   TEXT,
  imported_at  TEXT NOT NULL,
  stats_json   TEXT NOT NULL,
  slots_json   TEXT NOT NULL
);
-- One "current" set per character, one wishlist per character+phase: the
-- update flow is replace, never accumulate.
CREATE UNIQUE INDEX IF NOT EXISTS gear_sets_one_current
  ON gear_sets(character_id) WHERE kind = 'current';
CREATE UNIQUE INDEX IF NOT EXISTS gear_sets_one_wishlist_per_phase
  ON gear_sets(character_id, phase) WHERE kind = 'wishlist';
-- What an officer says a raider ACTUALLY has in one slot right now, pinned
-- from their recent logs. Overrides that slot of the imported set (and stands
-- alone when there is no import); deleting the row hands the slot back.
-- The spec column splits the main-spec kit from the off-spec one: a raider who
-- tanks on the side has two answers for the same slot, and only the main one
-- is what loot gets judged on.
CREATE TABLE IF NOT EXISTS current_gear_overrides (
  character_id TEXT NOT NULL REFERENCES characters(id),
  spec         TEXT NOT NULL DEFAULT 'main',
  slot         TEXT NOT NULL,
  item_id      INTEGER NOT NULL,
  item_name    TEXT NOT NULL,
  source       TEXT NOT NULL,
  set_at       TEXT NOT NULL,
  PRIMARY KEY (character_id, spec, slot)
);
-- Consumables used away from the boss pulls: trash, running back, buffing up.
-- One row per player per report — there is no fight to hang them on, and a
-- potion drunk on trash costs the same gold as one drunk on the boss. Pet food
-- and pet scrolls live here too, whenever in the night they were applied.
CREATE TABLE IF NOT EXISTS wcl_player_offpull (
  id                   TEXT PRIMARY KEY,
  report_code          TEXT NOT NULL REFERENCES wcl_reports(code),
  actor_name           TEXT NOT NULL,
  character_id         TEXT,
  potions_json         TEXT NOT NULL DEFAULT '[]',
  other_casts_json     TEXT NOT NULL DEFAULT '[]',
  drums                INTEGER NOT NULL DEFAULT 0,
  runes                INTEGER NOT NULL DEFAULT 0,
  healthstones         INTEGER NOT NULL DEFAULT 0,
  sappers              INTEGER NOT NULL DEFAULT 0,
  pet_consumables_json TEXT NOT NULL DEFAULT '[]',
  -- What the pet was seen HOLDING, which is not what anyone was seen doing:
  -- a pet has no combatantinfo, so its aura stream is the only evidence it was
  -- scrolled. Never counted or priced — see normalize.ts.
  pet_buffs_seen_json TEXT NOT NULL DEFAULT '[]',
  -- Dispels landed off the boss pulls, counted per (zone, spell, target, aura)
  -- rather than timed: trash is a hundred-odd segments a night and a timestamp
  -- against one of them answers nothing. The zone is what keeps a night that
  -- ran two instances readable.
  trash_dispels_json TEXT NOT NULL DEFAULT '[]',
  trash_interrupts_json TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS wcl_player_offpull_report ON wcl_player_offpull(report_code);
-- Ability names resolved from Wowhead, so a simulation's actions have names.
-- Warcraft Logs only names what somebody cast, which leaves exactly the
-- interesting rows ("the sim used Execute, you never did") as bare ids.
-- "spell" and "item" are separate id spaces that overlap (23827 is a sapper
-- charge AND Master Demonologist), so the kind is half the key.
CREATE TABLE IF NOT EXISTS abilities (
  kind          TEXT NOT NULL,
  id            INTEGER NOT NULL,
  name          TEXT NOT NULL,
  icon          TEXT,
  description   TEXT,
  -- For an item: the spell its Use effect casts, which is what the combat log
  -- records. Without it the same click is two rows in the sim comparison.
  use_spell_id  INTEGER,
  resolved_at   TEXT NOT NULL,
  PRIMARY KEY (kind, id)
);
-- SpellItemEnchantment id -> the effect text an item tooltip shows for it.
-- Its own id space, so it can't share the items table. Filled one lookup per
-- unknown id, ever; an id nothing can name simply has no row.
CREATE TABLE IF NOT EXISTS enchant_names (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  resolved_at TEXT NOT NULL
);
-- Item names taken to Wowhead and refused.
--
-- The queues that offer names for lookup are built from what the cache CANNOT
-- match, so without this a name Wowhead has already declined is indistinguishable
-- from one nobody has asked about: the button keeps offering the same count,
-- pressing it changes nothing, and the officer has no way to tell the two apart.
-- Same distinction the items table draws with armor_token: absent means
-- nobody asked, a row means we asked and the answer needs a person.
--
-- Keyed by the NORMALIZED name, because that is what the queues compare with.
-- A transport failure is deliberately never recorded: it says nothing about the
-- name and would take it out of a queue it belongs in.
CREATE TABLE IF NOT EXISTS item_name_lookups (
  name_key   TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  -- NameMissReason, minus "error": 'unknown' | 'no-exact' | 'ambiguous'.
  reason     TEXT NOT NULL,
  -- What Wowhead did offer, JSON. "Antonidas's …" beside the sheet's "Antonidas' …"
  -- is the whole answer to a near-miss, and it is a person's job to read it.
  near       TEXT NOT NULL DEFAULT '[]',
  checked_at TEXT NOT NULL
);
-- Officer edits to the council's spec priority sheet. Keyed by NORMALIZED item
-- name, not id: a sheet covers everything a boss can drop, most of which the
-- item cache has never heard of. Absent = the seeded sheet stands.
--
-- Keyed by phase as well, for the same reason wishlist_alternatives is: a chain
-- is written against a tier's raid, and the same item can be ranked differently
-- once the roster and the competition have moved on. Guild-wide chains put P5
-- items on the P2 sheet, which is what the council saw and reported.
CREATE TABLE IF NOT EXISTS item_priority_rules (
  item_key   TEXT NOT NULL,
  phase      INTEGER NOT NULL,
  item_name  TEXT NOT NULL,
  chain      TEXT NOT NULL,
  note       TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (item_key, phase)
);
-- The council's priority sheet per phase, as the markdown an officer pasted.
-- A document rather than a setting, which is why it earns a table: it is the
-- source the per-item rules above are layered on top of.
--
-- Absent for a phase means "nothing pasted": phase 3 then falls back to the
-- seeded sheet in src/data/seed, and every other phase is simply empty until
-- someone pastes one. So deleting a row is how you revert to the seed, exactly
-- as clearing an item_priority_rules row hands that item back to the sheet.
-- Alternatives a raider will take for a slot when their BiS doesn't drop.
--
-- The wishlist itself stays a whole imported gear set — that's what
-- SixtyUpgrades exports and what the stat diff needs. This sits BESIDE it: the
-- set names the BiS, and these name what else they'd accept, in order. Rank 1
-- is the first fallback, so the imported item is implicitly rank 0 and never
-- stored here.
--
-- Keyed by phase as well as slot, because "what I'd take instead" is a
-- statement about a tier, not about a character forever.
CREATE TABLE IF NOT EXISTS wishlist_alternatives (
  character_id TEXT NOT NULL,
  phase        INTEGER NOT NULL,
  slot         TEXT NOT NULL,
  item_id      INTEGER NOT NULL,
  item_name    TEXT,
  /* 1 = first fallback. Ties are broken by item id so ordering is total. */
  rank         INTEGER NOT NULL,
  note         TEXT,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (character_id, phase, slot, item_id)
);
-- The guild's own class/spec guides: what a class should be bringing, in the
-- officers' words. A class-level guide has spec = ''.
--
-- Deliberately the guild's summary WITH a source link, not a copy of somebody
-- else's page: the house rule is to name what a source actually says, and a
-- pasted guide rots silently while a summary an officer wrote gets corrected
-- when it stops being true.
/*
 * Everything the guild and the operator write down, in one table.
 *
 * Four parts to the key and each earns its place:
 *
 *   kind    'class' or 'raid' — what sort of thing is being described.
 *   subject 'Warrior', 'Black Temple'.
 *   section ''  for the subject itself, else 'Fury' or 'Supremus'.
 *   owner   'operator' for the shared baseline, else the guild's own id.
 *
 * Owner is the new half and the reason this replaced class_guides. A fight
 * write-up is the same for everybody and correcting it should not require a
 * release; what a particular guild does about it is theirs. Both rows exist at
 * once and neither overwrites the other — a guild reads the baseline as a
 * template and writes its own beside it.
 *
 * 'operator' is a reserved owner. Guild ids are generated, so a guild cannot
 * claim it by accident.
 */
CREATE TABLE IF NOT EXISTS guides (
  kind       TEXT NOT NULL,
  subject    TEXT NOT NULL,
  section    TEXT NOT NULL,
  owner      TEXT NOT NULL,
  body       TEXT NOT NULL,
  /* Newline-separated URLs the summary was drawn from. */
  sources    TEXT,
  /* Free text — there is no auth. Same compromise as character_comments. */
  author     TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (kind, subject, section, owner)
);
CREATE INDEX IF NOT EXISTS guides_by_subject ON guides(kind, subject);

CREATE TABLE IF NOT EXISTS class_guides (
  wow_class  TEXT NOT NULL,
  spec       TEXT NOT NULL,
  body       TEXT NOT NULL,
  /* Newline-separated URLs the summary was drawn from. */
  sources    TEXT,
  /* Free text — there is no auth. Same compromise as character_comments. */
  author     TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (wow_class, spec)
);
CREATE TABLE IF NOT EXISTS priority_sheets (
  phase      INTEGER PRIMARY KEY,
  markdown   TEXT NOT NULL,
  /* Free text — there is no auth. Same compromise as character_comments. */
  author     TEXT,
  note       TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS raid_sessions (
  id         TEXT PRIMARY KEY,
  guild_id   TEXT NOT NULL,
  date       TEXT NOT NULL,
  zones_json TEXT NOT NULL,
  note       TEXT,
  source     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS loot_awards (
  id              TEXT PRIMARY KEY,
  raid_session_id TEXT NOT NULL REFERENCES raid_sessions(id),
  character_id    TEXT,
  raw_winner_name TEXT NOT NULL,
  item_id         INTEGER NOT NULL,
  item_name       TEXT NOT NULL,
  awarded_at      TEXT NOT NULL,
  offspec         INTEGER NOT NULL,
  external        INTEGER NOT NULL DEFAULT 0,
  note            TEXT,
  /* How the council's board read when this was awarded, as JSON. NULL means
     the award never came from the ranking (a Gargul import, a hand-added
     drop) — never that the winner scored zero. See awardDecisionSchema. */
  decision_json   TEXT
);
CREATE INDEX IF NOT EXISTS loot_awards_dedupe
  ON loot_awards(item_id, raw_winner_name COLLATE NOCASE, awarded_at);
CREATE TABLE IF NOT EXISTS wcl_reports (
  code               TEXT PRIMARY KEY,
  title              TEXT NOT NULL,
  zone               TEXT,
  start_time         TEXT NOT NULL,
  end_time           TEXT NOT NULL,
  fetched_at         TEXT NOT NULL,
  -- Aura names requested at fetch time; see TRACKED_AURA_NAMES.
  upkeep_tracks_json TEXT NOT NULL DEFAULT '[]',
  enemy_casts_json TEXT NOT NULL DEFAULT '[]',
  -- Auras seen at boss pulls that the consumable tables couldn't place, as
  -- {name, abilityId, count}. Kept rather than shown once and lost: it is the
  -- only record of what this app failed to understand about a night, and it is
  -- what lets a later curation say WHICH reports need re-importing.
  unclassified_auras_json TEXT NOT NULL DEFAULT '[]',
  raid_session_id    TEXT
);
CREATE TABLE IF NOT EXISTS wcl_player_fights (
  id                    TEXT PRIMARY KEY,
  report_code           TEXT NOT NULL REFERENCES wcl_reports(code),
  fight_id              INTEGER NOT NULL,
  encounter_id          INTEGER NOT NULL,
  encounter_name        TEXT NOT NULL,
  kill                  INTEGER NOT NULL,
  fight_percentage      REAL,
  duration_ms           INTEGER NOT NULL,
  -- Pull start, in the report's own millisecond clock. Optional: reports
  -- imported before it was fetched have none, and the timeline says so rather
  -- than drawing them at zero.
  fight_start_ms        INTEGER,
  actor_name            TEXT NOT NULL,
  character_id          TEXT,
  class_name            TEXT,
  spec                  TEXT,
  role                  TEXT NOT NULL,
  parse_percent         REAL,
  bracket_percent       REAL,
  boss_parse_percent    REAL,
  boss_amount           REAL,
  amount                REAL,
  deaths                INTEGER NOT NULL DEFAULT 0,
  flask                 TEXT,
  elixirs_json          TEXT NOT NULL DEFAULT '[]',
  -- Flasks/elixirs applied after the pull started. Empty also means "imported
  -- before this was fetched" — nothing may read it as "nobody was late".
  late_consumables_json TEXT NOT NULL DEFAULT '[]',
  scrolls_json          TEXT NOT NULL DEFAULT '[]',
  food                  INTEGER NOT NULL DEFAULT 0,
  weapon_buff           INTEGER NOT NULL DEFAULT 0,
  prepot                INTEGER NOT NULL DEFAULT 0,
  prepot_label          TEXT,
  death_times_json      TEXT NOT NULL DEFAULT '[]',
  potions_json          TEXT NOT NULL DEFAULT '[]',
  other_casts_json      TEXT NOT NULL DEFAULT '[]',
  extras_json           TEXT NOT NULL DEFAULT '[]',
  cooldowns_json        TEXT NOT NULL DEFAULT '[]',
  cast_times_json       TEXT NOT NULL DEFAULT '[]',
  -- Who this raider took what off, and when — the source's side of a dispel.
  -- Unlike the cast and aura streams this one is fetched unfiltered, so a
  -- newly curated dispel spell renames old rows without a refetch; what needs
  -- a re-import is the fetch itself, which older reports predate.
  dispels_json          TEXT NOT NULL DEFAULT '[]',
  interrupts_json       TEXT NOT NULL DEFAULT '[]',
  upkeep_json           TEXT NOT NULL DEFAULT '[]',
  gear_json             TEXT NOT NULL DEFAULT '[]',
  talents_json          TEXT NOT NULL DEFAULT '[]',
  drums                 INTEGER NOT NULL DEFAULT 0,
  runes                 INTEGER NOT NULL DEFAULT 0,
  healthstones          INTEGER NOT NULL DEFAULT 0,
  sappers               INTEGER NOT NULL DEFAULT 0,
  missing_enchants_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS wcl_player_fights_by_report ON wcl_player_fights(report_code);
CREATE INDEX IF NOT EXISTS wcl_player_fights_by_character ON wcl_player_fights(character_id);
-- Excused absences: one row per character × reset week that shouldn't count.
CREATE TABLE IF NOT EXISTS attendance_exemptions (
  character_id TEXT NOT NULL REFERENCES characters(id),
  week_start   TEXT NOT NULL,
  note         TEXT,
  PRIMARY KEY (character_id, week_start)
);
-- Officer comment log: many per character, richer than the inline note.
CREATE TABLE IF NOT EXISTS character_comments (
  id           TEXT PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES characters(id),
  category     TEXT NOT NULL DEFAULT 'note',
  body         TEXT NOT NULL,
  author       TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS character_comments_by_character ON character_comments(character_id);
/*
 * Notes on one item — a raider's about their own claim, an officer's about the
 * council's. Deliberately NOT joined to a wishlist row: the note has to survive
 * the raider re-ordering their list, and it has to be readable next to an award
 * made years ago. character_id is nullable and means "about this raider's
 * claim" when set, "about the item" when not.
 *
 * Nothing here is scored. It exists because the council decided the
 * BiS-versus-second-choice call is too situational to automate.
 */
CREATE TABLE IF NOT EXISTS item_comments (
  id           TEXT PRIMARY KEY,
  item_id      INTEGER NOT NULL,
  character_id TEXT,
  voice        TEXT NOT NULL DEFAULT 'officer',
  body         TEXT NOT NULL,
  /* Free text — there is no auth. Same compromise as character_comments. */
  author       TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS item_comments_by_item ON item_comments(item_id);

/*
 * The council's running notes on one boss, shown under him on the loot plan.
 *
 * Distinct from a boss guide, which is durable prose about how the fight is
 * done. This is dated and appended — "saving tokens for the warriors this
 * reset", "Naj'entus trinket goes to a healer if it drops again" — the kind of
 * thing an officer says once and nobody can find three weeks later.
 *
 * Keyed by zone AND boss_key, never boss_key alone: trash is a drop source in
 * every raid, so "Trash" is only unique inside its zone. boss_key holds the
 * bossKey normalization, so a note survives a source spelling him differently
 * ("Illidari Council" against "The Illidari Council"); boss keeps the label
 * as it read when the note was written, which is what a reader recognises.
 *
 * Nothing here is scored, and no foreign key points at it — the same reasoning
 * as item_comments, plus one of its own: the raid table gains rows over time and
 * a note must not vanish because a boss was renamed under it.
 */
CREATE TABLE IF NOT EXISTS boss_comments (
  id         TEXT PRIMARY KEY,
  zone       TEXT NOT NULL,
  boss_key   TEXT NOT NULL,
  boss       TEXT NOT NULL,
  body       TEXT NOT NULL,
  /* Free text — there is no auth. Same compromise as character_comments. */
  author     TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS boss_comments_by_boss ON boss_comments(zone, boss_key);

/*
 * What each boss drops — the foundational layer, owned by whoever runs the
 * service rather than by any one guild.
 *
 * This is a FACT about the game: Supremus drops what Supremus drops, and it is
 * the same for every guild on every realm. It used to be smeared across three
 * places that each knew part of it — the raid table in code, Wowhead answers
 * cached on items.source, and the boss headings of one guild's priority sheet —
 * so correcting a single wrong item name meant editing a seed file and shipping
 * a release. Hammer of Judgment/Judgement cost exactly that.
 *
 * Deliberately NOT guild-scoped. A guild's own additions and removals live in
 * guild_boss_drops and are layered over the top at read time, so a guild can
 * disagree without editing anybody else's data and an operator can correct a
 * typo once for everyone.
 *
 * The key is natural rather than synthetic so an upsert is idempotent: pasting
 * the same drop table twice changes nothing. item_key is the normalized item
 * name, matching the priority sheet's own rule.
 *
 * item_id is nullable ON PURPOSE. A drop table is written in names — an
 * operator listing a boss's loot has names in front of them, not ids — and the
 * id arrives later from the same resolver every other item goes through. A row
 * with no id is a known drop the cache cannot picture yet, not an error.
 */
CREATE TABLE IF NOT EXISTS boss_drops (
  zone       TEXT NOT NULL,
  boss_key   TEXT NOT NULL,
  boss       TEXT NOT NULL,
  item_key   TEXT NOT NULL,
  item_name  TEXT NOT NULL,
  item_id    INTEGER,
  /* The finer wording a drop table uses: "Plate - Waist", "Main Hand Mace". */
  slot_label TEXT,
  note       TEXT,
  /* Free text — there is no auth. Same compromise as character_comments. */
  author     TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (zone, boss_key, item_key)
);
CREATE INDEX IF NOT EXISTS boss_drops_by_zone ON boss_drops(zone);

/*
 * One guild's disagreement with the foundational table above.
 *
 * Two actions and no third: 'add' means this guild also counts this drop from
 * this boss, 'hide' means it does not. A drop that moved between bosses is a
 * hide plus an add, which is clumsier to write and impossible to get half-
 * applied — a single 'move' row would need a target that could point at a boss
 * the overlay does not otherwise mention.
 *
 * The foundational row is never touched. That is the whole point: an operator
 * fixing a name must not silently revert a guild's ruling, and a guild must
 * never be able to edit what another guild reads.
 */
CREATE TABLE IF NOT EXISTS guild_boss_drops (
  guild_id   TEXT NOT NULL,
  zone       TEXT NOT NULL,
  boss_key   TEXT NOT NULL,
  boss       TEXT NOT NULL,
  item_key   TEXT NOT NULL,
  item_name  TEXT NOT NULL,
  item_id    INTEGER,
  /* 'add' | 'hide'. */
  action     TEXT NOT NULL,
  slot_label TEXT,
  note       TEXT,
  author     TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (guild_id, zone, boss_key, item_key)
);
CREATE INDEX IF NOT EXISTS guild_boss_drops_by_zone ON guild_boss_drops(guild_id, zone);

/*
 * Bug reports filed from inside the app. Deliberately references nothing —
 * a report has to stay readable after the page it describes has been rewritten
 * and after any character it mentions has been deleted, so the page is stored
 * as text and there are no foreign keys to go stale.
 */
CREATE TABLE IF NOT EXISTS feedback (
  id             TEXT PRIMARY KEY,
  /* 'bug' | 'feedback'. See the addColumn() in migrate() — this table shipped
     without it, so the CREATE here only covers databases made since. */
  kind           TEXT NOT NULL DEFAULT 'bug',
  reporter       TEXT,
  body           TEXT NOT NULL,
  route          TEXT NOT NULL,
  url            TEXT NOT NULL,
  /* NULL when the reporter declined to share page context. */
  context_json   TEXT,
  status         TEXT NOT NULL DEFAULT 'open',
  /* Triage, all added after the table shipped — see migrate(). */
  priority       TEXT NOT NULL DEFAULT 'unset',
  admin_note     TEXT,
  admin_note_author TEXT,
  admin_note_at  TEXT,
  /* Who closed it and when. Cleared on reopen: a signature left behind on a
     report somebody has reopened claims a decision that no longer stands. */
  resolved_by    TEXT,
  resolved_at    TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS feedback_by_status ON feedback(status, created_at DESC);
-- Identity. See docs/guild-and-player-profiles.md §3 and src/lib/auth.
--
-- Two of these tables sit OUTSIDE the read model on purpose: "accounts" and
-- "auth_sessions" are not guild data, they change on every login, and putting
-- them in the in-memory store would rebuild the whole model each time somebody
-- signs in. They are read directly, and their writes DO NOT bump data_version.
-- Everything else here is guild data and behaves normally.
CREATE TABLE IF NOT EXISTS accounts (
  id               TEXT PRIMARY KEY,
  /* Discord's snowflake — the only identity this app stores, and one account
     per identity. No passwords live here, so there is nothing in this table
     worth stealing a copy for. */
  discord_id       TEXT NOT NULL UNIQUE,
  discord_username TEXT,
  avatar_url       TEXT,
  app_admin        INTEGER NOT NULL DEFAULT 0,
  disabled         INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  last_seen_at     TEXT
);
-- The row id IS the SHA-256 of the cookie value, never the value. A dumped
-- database yields no usable session cookies.
CREATE TABLE IF NOT EXISTS auth_sessions (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id),
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  /* Kept rather than deleted on sign-out, so a leaked cookie stays dead. */
  revoked_at  TEXT,
  user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS auth_sessions_by_account ON auth_sessions(account_id);
-- A guild-defined role. "capabilities_json" is a list the role owns and the
-- update flow replaces wholesale — a join table would buy nothing.
CREATE TABLE IF NOT EXISTS guild_roles (
  id                TEXT PRIMARY KEY,
  guild_id          TEXT NOT NULL,
  name              TEXT NOT NULL,
  colour            TEXT,
  sort              INTEGER NOT NULL DEFAULT 0,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  /* The implicit baseline every membership carries. One per guild, undeletable. */
  baseline          INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS guild_roles_one_baseline
  ON guild_roles(guild_id) WHERE baseline = 1;
-- An account inside one guild: what this app means by "player".
CREATE TABLE IF NOT EXISTS memberships (
  id             TEXT PRIMARY KEY,
  guild_id       TEXT NOT NULL,
  account_id     TEXT NOT NULL REFERENCES accounts(id),
  display_name   TEXT NOT NULL,
  is_guild_master INTEGER NOT NULL DEFAULT 0,
  role_ids_json  TEXT NOT NULL DEFAULT '[]',
  joined_at      TEXT NOT NULL
);
-- One membership per account per guild, and one guild master per guild.
CREATE UNIQUE INDEX IF NOT EXISTS memberships_one_per_guild
  ON memberships(guild_id, account_id);
-- No unique index on ownership: a guild may have several owners. Real guilds
-- routinely have two or three people who would all call themselves the owner,
-- and one owner is a single point of failure the guild cannot repair by itself
-- -- ownership is not a capability, so no role can grant it back. The rule that
-- IS enforced lives in removeGuildOwner, because it has to count rows: a guild
-- can never reach zero owners.
-- An app admin MAY hold memberships, and usually does: the person running the
-- service is normally also somebody's guild master. Being an admin simply
-- grants nothing inside any guild -- see decide() in src/lib/auth/can.ts, where
-- guild capabilities come from a membership and never from the flag. That is
-- the property worth having, and it never needed two accounts to hold.
-- An officer's invitation, always for a character already on the roster.
-- Redeeming creates the membership and claims the character in one act.
CREATE TABLE IF NOT EXISTS guild_invites (
  id           TEXT PRIMARY KEY,
  guild_id     TEXT NOT NULL,
  character_id TEXT NOT NULL REFERENCES characters(id),
  /* SHA-256 of the code handed over; the code itself is never stored. */
  code_hash    TEXT NOT NULL UNIQUE,
  role_ids_json TEXT NOT NULL DEFAULT '[]',
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  redeemed_at  TEXT,
  redeemed_by  TEXT
);
-- An operator reaching into a guild they are not a member of.
--
-- The flag alone grants nothing inside any guild (section 7); this row is the
-- only thing that does, and it is deliberately awkward: it needs a reason, it
-- expires on its own so nobody has to remember to close it, and using it writes
-- into that guild's OWN audit log. An override the guild cannot see would be a
-- back door, so the visibility is part of the grant rather than a courtesy.
CREATE TABLE IF NOT EXISTS break_glass (
  id         TEXT PRIMARY KEY,
  guild_id   TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  reason     TEXT NOT NULL,
  opened_at  TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  closed_at  TEXT
);
CREATE INDEX IF NOT EXISTS break_glass_open ON break_glass(account_id, guild_id, closed_at);
-- What the guild is entitled to know happened to it. Break-glass is why this
-- exists: an override the guild cannot see is a back door, so the audit write
-- is part of the grant. Officers read this; it is not a service-side log.
CREATE TABLE IF NOT EXISTS guild_audit (
  id         TEXT PRIMARY KEY,
  guild_id   TEXT NOT NULL,
  kind       TEXT NOT NULL,
  actor      TEXT NOT NULL,
  reason     TEXT,
  detail     TEXT,
  at         TEXT NOT NULL,
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS guild_audit_by_guild ON guild_audit(guild_id, at DESC);
`;
