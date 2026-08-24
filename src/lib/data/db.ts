import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import {
  attendanceExemptionSchema,
  characterCommentSchema,
  itemCommentSchema,
  bossCommentSchema,
  bossDropSchema,
  guildBossDropSchema,
  characterSchema,
  currentGearOverrideSchema,
  feedbackReportSchema,
  accountSchema,
  authSessionSchema,
  guildAuditEntrySchema,
  guildInviteSchema,
  guildRoleSchema,
  membershipSchema,
  gearSetSchema,
  guildSchema,
  itemSchema,
  lootAwardSchema,
  raidSessionSchema,
  wclPlayerFightSchema,
  wclPlayerOffPullSchema,
  wclReportSchema,
} from "@/lib/import/schemas";
import type { AbilityInfo } from "@/lib/items/ability-data";
import {
  GROUP_COUNT,
  emptyBoard,
  isEmptyBoard,
  sanitizeBoard,
  sanitizeGuildRoster,
  type Board,
  type GuildRoster,
} from "@/lib/analysis/raid-planner";
import type { StrandedSimSetting } from "@/lib/types";
import { UPTIME_TRACK_BY_LABEL } from "@/lib/wcl/class-tracks";
import { normalizeItemName } from "@/lib/loot/priority-sheet";
import { loadSeedStore } from "@/lib/data/seed-data";
import { validateStore, type EntityStore } from "@/lib/data/store";
import type {
  AttendanceExemption,
  ConsumableAdjustment,
  Character,
  CharacterComment,
  ItemComment,
  BossComment,
  BossDrop,
  GuildBossDrop,
  ConsumablePrice,
  CurrentGearOverride,
  FeedbackReport,
  Account,
  AuthSession,
  GuildAuditEntry,
  GuildInvite,
  GuildRole,
  Membership,
  GearSet,
  Guild,
  Item,
  LootAward,
  RaidSession,
  WclPlayerFight,
  WclPlayerOffPull,
  WclReport,
} from "@/lib/types";

import { compareText } from "@/lib/sort";

/**
 * SQLite persistence on Node's built-in driver (node:sqlite) — no native
 * modules to compile. Nested values (slots, stats, zones) are stored as JSON
 * columns; every load re-validates rows against the canonical zod schemas so
 * schema drift surfaces as a loud error, never as a half-rendered page.
 *
 * The database file lives at data/projectlc.db (override: PROJECTLC_DB).
 * A fresh database is seeded from src/data/seed — delete the file to reset.
 */

const SCHEMA = `
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
     worth a request. See the STALE_PHASE tier in store.ts. */
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
  pet_consumables_json TEXT NOT NULL DEFAULT '[]'
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

function defaultDbPath(): string {
  return process.env.PROJECTLC_DB ?? path.join(process.cwd(), "data", "projectlc.db");
}

/* Keep one handle per path across dev HMR module re-evaluations. */
const globalDbs = globalThis as unknown as { __projectlcDbs?: Map<string, DatabaseSync> };

export function getDb(): DatabaseSync {
  const file = defaultDbPath();
  globalDbs.__projectlcDbs ??= new Map();
  const existing = globalDbs.__projectlcDbs.get(file);
  if (existing) return existing;

  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  migrate(db);
  seedIfEmpty(db);
  globalDbs.__projectlcDbs.set(file, db);
  return db;
}

/**
 * Fold `class_guides` into the general `guides` table.
 *
 * A key change rather than a column, so `addColumn` cannot do it — the rows are
 * copied and the old table dropped, once. Every existing guide was written by
 * the guild, so it is copied under the guild's own id; nothing becomes an
 * operator baseline by accident, because nobody has written one yet.
 *
 * Runs before the `addColumn` block so a database that never had class_guides
 * (a fresh one) does nothing and costs one PRAGMA.
 */
function migrateClassGuidesToGuides(db: DatabaseSync): void {
  const cols = db.prepare("PRAGMA table_info(class_guides)").all() as { name: string }[];
  if (cols.length === 0) return;
  const pending = db.prepare("SELECT COUNT(*) c FROM class_guides").get() as { c: number };
  if (pending.c > 0) {
    // The guild that wrote them. Single-guild deployments are the only ones
    // that can have rows here, so "the first guild" is exact rather than a
    // guess — but if there is somehow none, the rows are left in place rather
    // than filed under an owner nobody can read.
    const guild = db.prepare("SELECT id FROM guild LIMIT 1").get() as { id: string } | undefined;
    if (!guild) return;
    db.prepare(
      `INSERT OR IGNORE INTO guides (kind, subject, section, owner, body, sources, author, updated_at)
       SELECT 'class', wow_class, spec, ?, body, sources, author, updated_at FROM class_guides`,
    ).run(guild.id);
  }
  db.exec("DROP TABLE class_guides");
}

/** Additive migrations for databases created by earlier versions of the schema. */
function migrate(db: DatabaseSync): void {
  const addColumn = (table: string, column: string, ddl: string) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (cols.length === 0 || cols.some((c) => c.name === column)) return;
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    } catch (e) {
      // Parallel build workers can race the same migration; losing is fine.
      if (!/duplicate column/i.test(String(e))) throw e;
    }
  };
  migrateClassGuidesToGuides(db);
  addColumn("guild", "visibility", "visibility TEXT NOT NULL DEFAULT 'private'");
  addColumn("guild", "succession_admin_days", "succession_admin_days INTEGER");
  addColumn("guild", "succession_member_days", "succession_member_days INTEGER");
  addColumn("loot_awards", "external", "external INTEGER NOT NULL DEFAULT 0");
  addColumn("wcl_player_fights", "scrolls_json", "scrolls_json TEXT NOT NULL DEFAULT '[]'");
  addColumn("wcl_player_fights", "other_casts_json", "other_casts_json TEXT NOT NULL DEFAULT '[]'");
  addColumn("wcl_player_fights", "extras_json", "extras_json TEXT NOT NULL DEFAULT '[]'");
  addColumn("wcl_player_fights", "cooldowns_json", "cooldowns_json TEXT NOT NULL DEFAULT '[]'");
  addColumn("wcl_player_fights", "cast_times_json", "cast_times_json TEXT NOT NULL DEFAULT '[]'");
  addColumn("wcl_player_fights", "upkeep_json", "upkeep_json TEXT NOT NULL DEFAULT '[]'");
  addColumn("wcl_player_fights", "gear_json", "gear_json TEXT NOT NULL DEFAULT '[]'");
  addColumn("wcl_player_fights", "talents_json", "talents_json TEXT NOT NULL DEFAULT '[]'");
  addColumn("characters", "main_character_id", "main_character_id TEXT");
  // Every existing character starts unclaimed, which is the honest backfill:
  // nothing recorded who plays what, and nothing can now.
  addColumn("characters", "membership_id", "membership_id TEXT");
  // Co-owners: ownership stopped being unique per guild. Idempotent, and the
  // rule it enforced ("at least one owner") moved into removeGuildOwner, which
  // can count rows and this cannot.
  db.exec("DROP INDEX IF EXISTS memberships_one_guild_master");
  addColumn("characters", "off_spec", "off_spec TEXT");
  addColumn("characters", "off_spec_role", "off_spec_role TEXT");
  addColumn("wcl_player_fights", "sappers", "sappers INTEGER NOT NULL DEFAULT 0");
  addColumn("wcl_player_fights", "fight_start_ms", "fight_start_ms INTEGER");
  addColumn("wcl_player_fights", "prepot_label", "prepot_label TEXT");
  addColumn("wcl_player_fights", "death_times_json", "death_times_json TEXT NOT NULL DEFAULT '[]'");
  addColumn("wcl_player_fights", "boss_parse_percent", "boss_parse_percent REAL");
  addColumn("wcl_player_fights", "boss_amount", "boss_amount REAL");
  addColumn("wcl_reports", "upkeep_tracks_json", "upkeep_tracks_json TEXT NOT NULL DEFAULT '[]'");
  // Reports imported before this get an empty list, which is honest: the dump
  // was computed and shown at the time, and nothing kept it. It is not the same
  // as "this night had no unknown auras", so readers say "not recorded" rather
  // than "none" — the same distinction upkeep_tracks_json exists to make.
  addColumn(
    "wcl_reports",
    "unclassified_auras_json",
    "unclassified_auras_json TEXT NOT NULL DEFAULT '[]'",
  );
  // The feedback table shipped with only bug reports. Existing rows were filed
  // as bugs and the DEFAULT says so, so the backfill is the default itself.
  addColumn("feedback", "kind", "kind TEXT NOT NULL DEFAULT 'bug'");
  // Triage. Everything filed before these existed is untriaged, which is what
  // the default says — no backfill can invent a judgement nobody made.
  addColumn("feedback", "priority", "priority TEXT NOT NULL DEFAULT 'unset'");
  addColumn("feedback", "admin_note", "admin_note TEXT");
  // Notes written before anyone signed them keep no author, which is honest:
  // nothing recorded who wrote them and nothing can now.
  addColumn("feedback", "admin_note_author", "admin_note_author TEXT");
  addColumn("feedback", "admin_note_at", "admin_note_at TEXT");
  // Reports closed before this stay unsigned, and no backfill can fix that:
  // nothing recorded who closed them or when. NULL says exactly that, which is
  // the honest answer for a tool whose point is decisions you can defend later.
  addColumn("feedback", "resolved_by", "resolved_by TEXT");
  addColumn("feedback", "resolved_at", "resolved_at TEXT");
  // Awards made before this shipped have no snapshot, and cannot gain one: the
  // policy that produced them is gone. NULL says exactly that.
  addColumn("loot_awards", "decision_json", "decision_json TEXT");
  // The four loot weights moved into the `guild_policy` record, which holds
  // every other number the council can set too. The old value is deliberately
  // NOT carried across (the officers called it: the project is pre-release, and
  // a half-migrated policy is worse than a clean default). Dropping the row
  // rather than leaving it means nobody later mistakes it for live config.
  db.prepare("DELETE FROM meta WHERE key = ?").run("loot_priority_weights");
  verifyItemProvenance(db);
  backfillUpkeepTracks(db);
  relaxItemColumns(db);
  addAbilityKind(db);
  splitGearOverridesBySpec(db);
  promoteSimSettingsToProfiles(db);
  // AFTER relaxItemColumns, not with the addColumn block above. That rebuild
  // copies a fixed list of columns into a new table, so a column added to
  // `items` before it runs is created and then silently dropped on exactly the
  // databases old enough to need the rebuild — and nowhere else.
  addColumn("items", "armor_token", "armor_token INTEGER");
  // Every row confirmed before the phase was read off Wowhead's answer is
  // unchecked, which is what the default says: they get one more lookup each,
  // once, and are never asked again whether or not a phase came back.
  addColumn("items", "phase_checked", "phase_checked INTEGER NOT NULL DEFAULT 0");
  addColumn("items", "redeems_from", "redeems_from INTEGER");
  // AFTER relaxItemColumns too, and for a second reason: the backfill reads
  // `items.phase` to place each existing chain, so it has to run against the
  // rebuilt table rather than the one about to be dropped.
  scopePriorityRulesByPhase(db);
  // Last, and it has to be: this reads `armor_token` and `redeems_from`, and
  // both are created directly above — after the rebuild that would otherwise
  // drop them.
  repairArmorTokenClass(db);
}

/**
 * Reports imported before the track list was recorded get a **lower bound**:
 * every aura that actually appears in their rows was, provably, collected.
 *
 * Deliberately not a guess at the whole list. A track that was requested but
 * never landed can't be distinguished from one that was never requested, so it
 * stays out — that report will say "refetch to check" for it, which is true.
 * What this does buy is the common case: an aura the raid used all night is
 * confirmed as tracked without asking the officer to refetch everything again.
 */
/**
 * Un-file the rings that were filed as tier tokens.
 *
 * `parseWowheadItemXml` tested Wowhead's subclass without its class, and -2
 * under the Armor class means Rings rather than Armor Tokens. Two things
 * followed, both silent: the token-mapping queue filled with rings whose pages
 * name no pieces, so it never drained however many times an officer pressed;
 * and an authoritative write clears the slot of anything it believes is a
 * token, so every ring in the cache lost its slot — which is what the wishlist
 * slot families and the "already served this slot" loot penalty read.
 *
 * The flag is cleared rather than corrected, because "not a token" and "nobody
 * has asked" are the same state as far as the queue is concerned. **Rows
 * something redeems from are left alone**: a piece pointing at them is proof
 * the vendor listing named pieces, which no ring will ever do.
 *
 * `verified` goes with it, and that is what actually repairs the damage. The
 * token queue skips any row a gear set names, so clearing the flag alone would
 * leave every ring somebody wishlisted flagless *and* slotless for ever —
 * invisible to both queues. Un-verifying is also the honest description: these
 * rows were written by a classifier that was wrong about them, so the one thing
 * `verified` is supposed to promise isn't true. The item backfill re-asks, and
 * the same authoritative write puts the slot back.
 *
 * Runs once. Without the sentinel it would clear a real token that simply has
 * no pieces mapped yet, on every boot, and the queue would ping-pong for ever —
 * which is the exact symptom this exists to fix.
 */
function repairArmorTokenClass(db: DatabaseSync): void {
  const KEY = "repair:armor_token_needs_class";
  if (db.prepare("SELECT 1 FROM meta WHERE key = ?").get(KEY)) return;
  db.prepare(
    `UPDATE items SET armor_token = NULL, verified = 0
      WHERE armor_token = 1
        AND id NOT IN (SELECT redeems_from FROM items WHERE redeems_from IS NOT NULL)`,
  ).run();
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
    KEY,
    new Date().toISOString(),
  );
}

function backfillUpkeepTracks(db: DatabaseSync): void {
  const stale = db
    .prepare("SELECT code FROM wcl_reports WHERE upkeep_tracks_json = '[]' OR upkeep_tracks_json IS NULL")
    .all() as { code: string }[];
  if (stale.length === 0) return;
  const rowsFor = db.prepare("SELECT upkeep_json FROM wcl_player_fights WHERE report_code = ?");
  const update = db.prepare("UPDATE wcl_reports SET upkeep_tracks_json = ? WHERE code = ?");
  for (const { code } of stale) {
    const seen = new Set<string>();
    for (const r of rowsFor.all(code) as Row[]) {
      for (const track of JSON.parse((r.upkeep_json as string | null) ?? "[]") as { name: string }[]) {
        // Rows store the display label; the stamp is in track names.
        const known = UPTIME_TRACK_BY_LABEL.get(track.name.toLowerCase());
        seen.add(known?.name ?? track.name);
      }
    }
    if (seen.size > 0) update.run(JSON.stringify([...seen].sort()), code);
  }
}

/**
 * The item cache used to have no idea where any of its rows came from, so a
 * hand-written guess and Wowhead's own answer were indistinguishable — and
 * `listUnresolvedItemIds` only ever offered up rows with a *missing* field.
 * A wrong icon has no missing field, so it could never be corrected: eight
 * reports of the wrong item picture all landed on curated seed rows.
 *
 * `verified` splits the two apart. Backfilling it needs a rule for rows that
 * predate the column, and the honest one is narrow: at the time this ran, the
 * seed was the only writer of `source_json` (Wowhead's XML has no zone/boss,
 * and neither do logs or wishlists), so a row carrying one is hand-written and
 * a row without one came from a machine that read the game's own data.
 *
 * Machine-sourced rows are therefore trusted and the curated ones are queued
 * for re-resolution. Nothing is deleted — a guessed icon keeps rendering until
 * Wowhead replaces it, which is strictly better than a blank.
 */
function verifyItemProvenance(db: DatabaseSync): void {
  const cols = db.prepare("PRAGMA table_info(items)").all() as { name: string }[];
  if (cols.length === 0 || cols.some((c) => c.name === "verified")) return;
  db.exec("ALTER TABLE items ADD COLUMN verified INTEGER NOT NULL DEFAULT 0");
  db.exec("UPDATE items SET verified = 1 WHERE source_json IS NULL");
}

/**
 * The Wowhead name cache used to be keyed on a bare id, which cannot hold both
 * spell 23827 and item 23827 — and looking every sim action up as a spell is
 * how Bloodlust Brooch came back named "Holy Light".
 *
 * Dropped rather than copied across. Its descriptions came from a parser that
 * read a spell tooltip's requirements instead of its effect, and rows are never
 * overwritten once written — so migrating them would preserve wrong text
 * permanently, with no way to ask again. It is a cache of public data behind
 * one button press, and re-resolving it is cheap.
 */
function addAbilityKind(db: DatabaseSync): void {
  const old = db.prepare("PRAGMA table_info(spells)").all() as { name: string }[];
  if (old.length === 0) return;
  db.exec("DROP TABLE spells;");
}

/**
 * Officer chains used to be one row per item, applying to every phase at once.
 *
 * That put both Warglaives — chains an officer wrote against the tier they drop
 * in — on the phase 2 sheet, as "unlisted" officer edits, because a chain the
 * phase's sheet didn't name is shown on every phase's page. The key gains
 * `phase`, which SQLite can't do with ALTER TABLE.
 *
 * **The backfill resolves each chain's phase from the item, not from the guild's
 * current one.** The alternative — stamping every existing chain with the active
 * phase — would move each one onto the sheet the officer was *not* looking at
 * when they wrote it, and there is a better answer available: the same name → id
 * resolution the sheet view uses (an officer's `sheet_item_ids` pin first,
 * because they pinned it precisely because the name is ambiguous, then an exact
 * name match), and then that item's own phase. A chain whose item the cache
 * can't place keeps applying to the guild's current phase, and the sheet row
 * shows which phase it belongs to so an officer can move it.
 */
function scopePriorityRulesByPhase(db: DatabaseSync): void {
  const cols = db.prepare("PRAGMA table_info(item_priority_rules)").all() as { name: string }[];
  if (cols.length === 0 || cols.some((c) => c.name === "phase")) return;

  const rules = db.prepare("SELECT item_key, item_name, chain, note, updated_at FROM item_priority_rules").all() as {
    item_key: string;
    item_name: string;
    chain: string;
    note: string | null;
    updated_at: string;
  }[];

  const activePhase =
    (db.prepare("SELECT active_phase FROM guild LIMIT 1").get() as { active_phase?: number } | undefined)
      ?.active_phase ?? 1;

  // The officer's pins, keyed the same way the read model keys them.
  const pinRow = db.prepare("SELECT value FROM meta WHERE key = 'sheet_item_ids'").get() as
    | { value?: string }
    | undefined;
  let pins: Record<string, number> = {};
  if (pinRow?.value) {
    try {
      pins = JSON.parse(pinRow.value) as Record<string, number>;
    } catch {
      // A corrupt pin blob must not cost the guild their chains — fall through
      // to name matching, which is what an unpinned row gets anyway.
    }
  }

  const phaseById = new Map<number, number>();
  for (const row of db.prepare("SELECT id, phase FROM items WHERE phase IS NOT NULL").all() as {
    id: number;
    phase: number;
  }[]) {
    phaseById.set(row.id, row.phase);
  }
  const idByName = new Map<string, number>();
  for (const row of db.prepare("SELECT id, name FROM items WHERE name IS NOT NULL").all() as {
    id: number;
    name: string;
  }[]) {
    idByName.set(normalizeItemName(row.name), row.id);
  }

  const phaseOf = (itemKey: string): number => {
    const itemId = pins[itemKey] ?? idByName.get(itemKey);
    return (itemId === undefined ? undefined : phaseById.get(itemId)) ?? activePhase;
  };

  db.exec(`
    CREATE TABLE item_priority_rules_phased (
      item_key   TEXT NOT NULL,
      phase      INTEGER NOT NULL,
      item_name  TEXT NOT NULL,
      chain      TEXT NOT NULL,
      note       TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (item_key, phase)
    );
  `);
  const insert = db.prepare(
    `INSERT OR REPLACE INTO item_priority_rules_phased
       (item_key, phase, item_name, chain, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const rule of rules) {
    insert.run(rule.item_key, phaseOf(rule.item_key), rule.item_name, rule.chain, rule.note, rule.updated_at);
  }
  db.exec(`
    DROP TABLE item_priority_rules;
    ALTER TABLE item_priority_rules_phased RENAME TO item_priority_rules;
  `);
}

/**
 * Current-gear pins used to be one row per character × slot. Off-spec gear
 * needs two answers for the same slot, so the key gains `spec` — which SQLite
 * can't do with ALTER TABLE. Rebuilt once; every existing pin is main-spec.
 */
function splitGearOverridesBySpec(db: DatabaseSync): void {
  const cols = db.prepare("PRAGMA table_info(current_gear_overrides)").all() as { name: string }[];
  if (cols.length === 0 || cols.some((c) => c.name === "spec")) return;
  db.exec(`
    CREATE TABLE current_gear_overrides_spec (
      character_id TEXT NOT NULL REFERENCES characters(id),
      spec         TEXT NOT NULL DEFAULT 'main',
      slot         TEXT NOT NULL,
      item_id      INTEGER NOT NULL,
      item_name    TEXT NOT NULL,
      source       TEXT NOT NULL,
      set_at       TEXT NOT NULL,
      PRIMARY KEY (character_id, spec, slot)
    );
    INSERT INTO current_gear_overrides_spec
        (character_id, spec, slot, item_id, item_name, source, set_at)
      SELECT character_id, 'main', slot, item_id, item_name, source, set_at
        FROM current_gear_overrides;
    DROP TABLE current_gear_overrides;
    ALTER TABLE current_gear_overrides_spec RENAME TO current_gear_overrides;
  `);
}

/**
 * Older databases declared items.name/quality/icon NOT NULL, which blocks the
 * partial entries the cache now stores. SQLite can't drop a NOT NULL, so the
 * table is rebuilt once — contents preserved.
 *
 * Only those three are asked about. `verified` is NOT NULL on purpose, so a
 * blanket "any NOT NULL column means rebuild" would fire on every fresh
 * database forever — and the rebuild below would drop the column on the way
 * through. It runs after verifyItemProvenance for the same reason: by here the
 * column always exists, so it can be copied unconditionally.
 */
const RELAXED_ITEM_COLUMNS = ["name", "quality", "icon"];

function relaxItemColumns(db: DatabaseSync): void {
  const cols = db.prepare("PRAGMA table_info(items)").all() as { name: string; notnull: number }[];
  const required = cols.filter((c) => RELAXED_ITEM_COLUMNS.includes(c.name) && c.notnull === 1);
  if (required.length === 0) return;
  db.exec(`
    CREATE TABLE items_relaxed (
      id          INTEGER PRIMARY KEY,
      name        TEXT,
      quality     TEXT,
      icon        TEXT,
      slot        TEXT,
      source_json TEXT,
      phase       INTEGER,
      verified    INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO items_relaxed (id, name, quality, icon, slot, source_json, phase, verified)
      SELECT id, name, quality, icon, slot, source_json, phase, verified FROM items;
    DROP TABLE items;
    ALTER TABLE items_relaxed RENAME TO items;
  `);
}

export function withTx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** Monotonic data version — bumped on every mutation so cached read models know to reload. */
export function getDataVersion(db: DatabaseSync): number {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'data_version'").get() as
    | { value: string }
    | undefined;
  return row ? Number(row.value) : 0;
}

export function bumpDataVersion(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('data_version', '1')
     ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)`,
  ).run();
}

/* Per-report consumable prices: editable, per raid night, stored as a JSON blob
   in the meta table keyed by report code. Absent = the raid uses code defaults. */

const consumablePriceKey = (code: string) => `consumable_prices:${code}`;

/** Keep only well-formed { gold, charges } numbers so a hand-edited blob can't crash a read. */
function sanitizePrices(raw: unknown): Record<string, ConsumablePrice> {
  if (raw === null || typeof raw !== "object") return {};
  const out: Record<string, ConsumablePrice> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === null || typeof value !== "object") continue;
    const { gold, charges } = value as Record<string, unknown>;
    if (typeof gold === "number" && Number.isFinite(gold) && gold >= 0) {
      const c = typeof charges === "number" && Number.isFinite(charges) && charges >= 1 ? charges : 1;
      out[name] = { gold, charges: c };
    }
  }
  return out;
}

/** A report's logged consumable prices (empty when the raid hasn't set any). */
export function getReportConsumablePrices(db: DatabaseSync, code: string): Record<string, ConsumablePrice> {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(consumablePriceKey(code)) as
    | { value: string }
    | undefined;
  if (!row) return {};
  try {
    return sanitizePrices(JSON.parse(row.value));
  } catch {
    return {};
  }
}

/** Persist a report's consumable prices (replaces the whole blob for that report). */
export function setReportConsumablePrices(
  db: DatabaseSync,
  code: string,
  prices: Record<string, ConsumablePrice>,
): void {
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(consumablePriceKey(code), JSON.stringify(sanitizePrices(prices)));
}

/*
 * Per-report raid board: who stood in which group that night.
 *
 * Same meta-table pattern as prices, and it has to be stored rather than
 * derived, because Warcraft Logs does not record group assignments at all —
 * the pull rows know everyone who was there and nothing about how they were
 * arranged. So this is an officer's record, seeded from the log's attendees.
 *
 * Absent means nobody has laid the night out yet, which the page offers to do.
 */

const raidBoardKey = (code: string) => `raid_board:${code}`;

/**
 * The template's board — guild-wide, so no suffix, like
 * `loot_priority_weights`. Deliberately a different key from any raid's: a plan
 * for next Wednesday is not a record of a night that happened, and the two must
 * never be able to overwrite each other.
 */
const TEMPLATE_BOARD_KEY = "template_board";

export function getTemplateBoard(db: DatabaseSync): Board {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(TEMPLATE_BOARD_KEY) as
    | { value: string }
    | undefined;
  return readBoard(row?.value);
}

export function setTemplateBoard(db: DatabaseSync, comp: Board): void {
  const clean = sanitizeBoard(comp, { groups: comp.groups.length });
  if (nothingToRemember(clean)) {
    db.prepare("DELETE FROM meta WHERE key = ?").run(TEMPLATE_BOARD_KEY);
    return;
  }
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(TEMPLATE_BOARD_KEY, JSON.stringify(clean));
}

/*
 * The guild's own named rosters: `guild_roster:<id>`.
 *
 * Several, because a guild that runs a split has more than one roster at once.
 * One row each rather than one row holding a list, so two officers on two
 * rosters can't overwrite each other's work — the boards autosave, and a shared
 * row would make every save a full rewrite of every roster.
 *
 * The one rule that differs from every other board here: **an empty board
 * still gets a row.** A raid night's empty board means "never laid out", which
 * is worth nothing to store; a roster exists because somebody made and named
 * it, and deleting it on the first Clear would take the name with it.
 */

const GUILD_ROSTER_PREFIX = "guild_roster:";
const guildRosterKey = (id: string) => `${GUILD_ROSTER_PREFIX}${id}`;

/*
 * `_` is a single-character wildcard in SQL LIKE, so the obvious
 * `LIKE 'guild_roster:%'` also matches `guildXroster:…`. Nothing writes such a
 * key today, which is exactly why this would go unnoticed if one ever did.
 */
const GUILD_ROSTER_LIKE = "guild\\_roster:%";

/** Every guild roster, oldest first — the order the picker shows them in. */
export function listGuildRosters(db: DatabaseSync): GuildRoster[] {
  const rows = db
    .prepare("SELECT value FROM meta WHERE key LIKE ? ESCAPE '\\'")
    .all(GUILD_ROSTER_LIKE) as { value: string }[];
  return rows
    .map((r) => readGuildRoster(r.value))
    .filter((b): b is GuildRoster => b !== undefined)
    .sort((a, b) => compareText(a.createdAt, b.createdAt) || compareText(a.id, b.id));
}

export function getGuildRoster(db: DatabaseSync, id: string): GuildRoster | undefined {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(guildRosterKey(id)) as
    | { value: string }
    | undefined;
  return readGuildRoster(row?.value);
}

function readGuildRoster(value: string | undefined): GuildRoster | undefined {
  if (!value) return undefined;
  try {
    return sanitizeGuildRoster(JSON.parse(value));
  } catch {
    return undefined;
  }
}

export function setGuildRoster(db: DatabaseSync, board: GuildRoster): void {
  const clean = sanitizeGuildRoster(board);
  if (!clean) throw new Error("A roster needs an id and a name.");
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(guildRosterKey(clean.id), JSON.stringify(clean));
}

/**
 * Change part of a board, leaving the rest alone.
 *
 * Read-modify-write inside the caller's transaction, because the three things a
 * board holds are edited by three different controls: the board
 * autosaves as an officer drags, the name as they type it, the prospects when
 * they add one. A blind full write from any of those would drop the other two.
 *
 * A board that has been deleted is not resurrected — the officer who deleted it
 * meant it, and the autosave still in flight from another tab did not.
 */
export function updateGuildRoster(
  db: DatabaseSync,
  id: string,
  patch: Partial<Pick<GuildRoster, "name" | "prospects" | "board">>,
): void {
  const existing = getGuildRoster(db, id);
  if (!existing) return;
  setGuildRoster(db, { ...existing, ...patch });
}

export function deleteGuildRoster(db: DatabaseSync, id: string): void {
  db.prepare("DELETE FROM meta WHERE key = ?").run(guildRosterKey(id));
}

/** A report's saved board, or an empty board when none was written. */
export function getRaidBoard(db: DatabaseSync, code: string): Board {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(raidBoardKey(code)) as
    | { value: string }
    | undefined;
  return readBoard(row?.value);
}

/**
 * Parse a stored board, keeping the number of groups it was saved with.
 *
 * Group count is part of the record now — an officer who runs five groups
 * shouldn't reopen the page to three empty ones tacked on the end — so it comes
 * from the blob rather than from the eight a raid frame allows. A missing or
 * corrupt row reads as an empty board rather than throwing a page.
 */
/**
 * Is this board worth a row?
 *
 * Nobody placed *and* nothing else set. A board can be empty of raiders and
 * still carry work — five groups named for the assignments, or a bench of
 * planned slots — and dropping that because the groups happen to be empty would
 * lose an officer's setup the moment they cleared the board to start again.
 */
function nothingToRemember(comp: Board): boolean {
  return (
    isEmptyBoard(comp) &&
    !comp.groupNames?.some(Boolean) &&
    (comp.bench?.length ?? 0) === 0 &&
    comp.groups.length === GROUP_COUNT
  );
}

function readBoard(value: string | undefined): Board {
  if (!value) return emptyBoard();
  try {
    const parsed = JSON.parse(value) as { groups?: unknown };
    const groups = Array.isArray(parsed?.groups) ? parsed.groups.length : undefined;
    return sanitizeBoard(parsed, groups ? { groups } : {});
  } catch {
    return emptyBoard();
  }
}

/**
 * Persist a report's board (replaces the whole board). A board with
 * nobody on it deletes the row, so "never laid out" and "laid out, then
 * cleared" read the same — there is nothing to remember about an empty board.
 */
export function setRaidBoard(db: DatabaseSync, code: string, comp: Board): void {
  const clean = sanitizeBoard(comp, { groups: comp.groups.length });
  const key = raidBoardKey(code);
  if (nothingToRemember(clean)) {
    db.prepare("DELETE FROM meta WHERE key = ?").run(key);
    return;
  }
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, JSON.stringify(clean));
}

/* Per-character wowsims setup: the decoded export a raider's comparison runs
   against. Same meta-table pattern as prices, keyed by character slug — a
   build, a rotation and a buff set belong to one raider, not to the guild.
   Absent means that character has no sim configured yet. */

export function getAbilities(db: DatabaseSync): AbilityInfo[] {
  return (
    db.prepare("SELECT kind, id, name, icon, description, use_spell_id FROM abilities").all() as Row[]
  ).map((r) => ({
    kind: r.kind === "item" ? "item" : "spell",
    id: Number(r.id),
    name: String(r.name),
    icon: (r.icon as string | null) ?? undefined,
    description: (r.description as string | null) ?? undefined,
    useSpellId: (r.use_spell_id as number | null) ?? undefined,
  }));
}

/** Record resolved abilities. Refs already known are left alone. */
export function addAbilities(db: DatabaseSync, abilities: AbilityInfo[]): number {
  const stmt = db.prepare(
    `INSERT INTO abilities (kind, id, name, icon, description, use_spell_id, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(kind, id) DO NOTHING`,
  );
  const now = new Date().toISOString();
  let written = 0;
  for (const a of abilities) {
    if (!Number.isFinite(a.id) || a.id <= 0 || !a.name) continue;
    written += Number(
      stmt.run(a.kind, a.id, a.name, a.icon ?? null, a.description ?? null, a.useSpellId ?? null, now)
        .changes,
    );
  }
  return written;
}

/*
 * Sim setups belong to a class and spec, not to a raider.
 *
 * A wowsims export supplies the rotation, the buffs and the consumables a spec
 * is expected to run; the gear, the talents and the fight length come from the
 * pull instead. Almost none of that is personal, so keying it per character —
 * the `sim_settings:<slug>` rows this replaced — meant every raider needed their
 * own pasted link before they could be simmed at all. Whatever IS personal, like
 * race and professions, is stated as an assumption by the pre-run check rather
 * than silently applied. See src/lib/sim/profile.ts.
 */

const SIM_PROFILE_PREFIX = "sim_profile:";
/** The per-character key this replaced. Still read, once, by the promotion below. */
const LEGACY_SIM_SETTINGS_PREFIX = "sim_settings:";

const simProfileKey = (wowClass: string, spec: string) =>
  `${SIM_PROFILE_PREFIX}${wowClass}:${spec}`;

export interface SimProfileRow {
  wowClass: string;
  spec: string;
  /** The raw protojson the CLI printed. */
  json: string;
}

export function getSimProfile(db: DatabaseSync, wowClass: string, spec: string): string | undefined {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(simProfileKey(wowClass, spec)) as
    | { value: string }
    | undefined;
  if (!row) return undefined;
  // Parsed on read so a corrupted blob reads as "not configured" rather than
  // crashing the page.
  try {
    JSON.parse(row.value);
    return row.value;
  } catch {
    return undefined;
  }
}

/** Every saved spec profile. The key carries the class and spec verbatim. */
export function listSimProfiles(db: DatabaseSync): SimProfileRow[] {
  const rows = db
    .prepare("SELECT key, value FROM meta WHERE key LIKE ? ORDER BY key")
    .all(`${SIM_PROFILE_PREFIX}%`) as { key: string; value: string }[];
  const out: SimProfileRow[] = [];
  for (const { key, value } of rows) {
    const rest = key.slice(SIM_PROFILE_PREFIX.length);
    const sep = rest.indexOf(":");
    if (sep <= 0 || sep === rest.length - 1) continue;
    try {
      JSON.parse(value);
    } catch {
      continue;
    }
    out.push({ wowClass: rest.slice(0, sep), spec: rest.slice(sep + 1), json: value });
  }
  return out;
}

/** Save (or clear, with undefined) one spec's sim setup. */
export function setSimProfile(
  db: DatabaseSync,
  wowClass: string,
  spec: string,
  json: string | undefined,
): void {
  const key = simProfileKey(wowClass, spec);
  if (json === undefined) {
    db.prepare("DELETE FROM meta WHERE key = ?").run(key);
    return;
  }
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, json);
}

/**
 * The per-character setups, with the spec each one resolves to.
 *
 * Resolved the way the app resolves a spec everywhere else: the setup's talent
 * tree totals, matched against the builds this guild's own logs have already
 * named (see sim/profile.ts). Nothing is hard-coded — a talent tree is never
 * assumed here to mean a spec.
 */
export function listStrandedSimSettings(db: DatabaseSync): StrandedSimSetting[] {
  const saved = db
    .prepare("SELECT key, value FROM meta WHERE key LIKE ?")
    .all(`${LEGACY_SIM_SETTINGS_PREFIX}%`) as { key: string; value: string }[];
  if (saved.length === 0) return [];

  /* class + build → the spec names the logs used for it. */
  const named = db
    .prepare(
      `SELECT class_name AS cls, spec, talents_json AS talents, COUNT(*) AS n
         FROM wcl_player_fights
        WHERE spec IS NOT NULL AND class_name IS NOT NULL
        GROUP BY cls, spec, talents`,
    )
    .all() as { cls: string; spec: string; talents: string | null; n: number }[];
  const byBuild = new Map<string, Map<string, number>>();
  for (const r of named) {
    const points = parseTreePoints(r.talents);
    if (!points) continue;
    const key = `${r.cls}|${points}`;
    const inner = byBuild.get(key) ?? new Map<string, number>();
    inner.set(r.spec, (inner.get(r.spec) ?? 0) + Number(r.n));
    byBuild.set(key, inner);
  }

  const out: StrandedSimSetting[] = [];
  for (const { key, value } of saved) {
    const slug = key.slice(LEGACY_SIM_SETTINGS_PREFIX.length);
    let settings: { player?: { class?: unknown; talentsString?: unknown } };
    try {
      settings = JSON.parse(value) as typeof settings;
    } catch {
      continue;
    }
    const stated =
      typeof settings.player?.class === "string"
        ? settings.player.class.replace(/^Class/, "")
        : undefined;
    // The character's own class wins where we have it — an export could have
    // been pasted onto the wrong raider.
    const owner = db
      .prepare("SELECT class FROM characters WHERE lower(name) = ?")
      .get(slug.toLowerCase()) as { class: string } | undefined;
    const wowClass = owner?.class ?? stated;
    const build =
      typeof settings.player?.talentsString === "string"
        ? treePointsFromString(settings.player.talentsString)
        : undefined;
    const specs =
      wowClass && build ? [...(byBuild.get(`${wowClass}|${build}`)?.keys() ?? [])].sort() : [];
    out.push({ slug, json: value, wowClass, build, specs });
  }
  return out;
}

/**
 * Promote those setups into spec profiles.
 *
 * Deliberately a COPY, not a move. Where the build is ambiguous — the logs
 * genuinely call 0/44/17 Feral, Guardian and Warden — this writes nothing, and
 * the spec page offers the setup for the officer to adopt by hand instead.
 * Deleting the only wowsims link they ever pasted because a fingerprint couldn't
 * decide is not a failure mode worth having.
 *
 * Idempotent: an existing profile is never overwritten, so one edited by hand
 * survives every later boot.
 */
function promoteSimSettingsToProfiles(db: DatabaseSync): void {
  const stranded = listStrandedSimSettings(db);
  if (stranded.length === 0) return;
  const existing = new Set(
    (
      db.prepare("SELECT key FROM meta WHERE key LIKE ?").all(`${SIM_PROFILE_PREFIX}%`) as {
        key: string;
      }[]
    ).map((r) => r.key),
  );
  for (const s of stranded) {
    if (!s.wowClass || s.specs.length !== 1) continue;
    const target = simProfileKey(s.wowClass, s.specs[0]);
    if (existing.has(target)) continue;
    db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(target, s.json);
    existing.add(target);
  }
}

/** "3400502130201-55000005505012050115" → "21/40/0". */
function treePointsFromString(talentsString: string): string {
  return padTrees(
    talentsString
      .split("-")
      .map((tree) => [...tree].reduce((sum, ch) => sum + (Number.parseInt(ch, 10) || 0), 0)),
  );
}

/** The logs' `talents_json` in the same shape, or undefined when it has none. */
function parseTreePoints(json: string | null): string | undefined {
  if (!json) return undefined;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
    return padTrees(parsed.map((n) => (typeof n === "number" ? n : 0)));
  } catch {
    return undefined;
  }
}

/**
 * Both sides padded to three trees. wowsims drops trailing empty ones ("21/40")
 * and the logs never do ("21/40/0") — compared unpadded they match nothing, and
 * every setup would look stranded.
 */
function padTrees(trees: number[]): string {
  const width = Math.max(3, trees.length);
  return Array.from({ length: width }, (_, i) => trees[i] ?? 0).join("/");
}

/* Per-report consumable adjustments: an officer's corrections to what the log
   says each raider got through. Same meta-table pattern as prices; absent
   means the raid's gold is exactly what the log implied. */

const consumableAdjustmentKey = (code: string) => `consumable_adjustments:${code}`;

/** Drop anything malformed so a hand-edited blob can't crash a read. */
function sanitizeAdjustments(raw: unknown): ConsumableAdjustment[] {
  if (!Array.isArray(raw)) return [];
  const out: ConsumableAdjustment[] = [];
  for (const value of raw) {
    if (value === null || typeof value !== "object") continue;
    const { actorName, name, delta, note, by, at } = value as Record<string, unknown>;
    if (typeof actorName !== "string" || actorName.trim() === "") continue;
    if (typeof name !== "string" || name.trim() === "") continue;
    if (typeof delta !== "number" || !Number.isInteger(delta) || delta === 0) continue;
    out.push({
      actorName: actorName.trim(),
      name: name.trim(),
      delta,
      note: typeof note === "string" && note.trim() !== "" ? note.trim() : undefined,
      by: typeof by === "string" && by.trim() !== "" ? by.trim() : undefined,
      at: typeof at === "string" && at !== "" ? at : new Date(0).toISOString(),
    });
  }
  return out;
}

/** One report's hand adjustments (empty when nobody has corrected anything). */
export function getReportConsumableAdjustments(db: DatabaseSync, code: string): ConsumableAdjustment[] {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(consumableAdjustmentKey(code)) as
    | { value: string }
    | undefined;
  if (!row) return [];
  try {
    return sanitizeAdjustments(JSON.parse(row.value));
  } catch {
    return [];
  }
}

/** Every report's adjustments in one query — the career gold rollup needs them all. */
export function getAllConsumableAdjustments(db: DatabaseSync): Record<string, ConsumableAdjustment[]> {
  const rows = db
    .prepare("SELECT key, value FROM meta WHERE key LIKE 'consumable_adjustments:%'")
    .all() as { key: string; value: string }[];
  const out: Record<string, ConsumableAdjustment[]> = {};
  for (const { key, value } of rows) {
    try {
      out[key.slice("consumable_adjustments:".length)] = sanitizeAdjustments(JSON.parse(value));
    } catch {
      // A mangled blob just means "nothing adjusted" for that report.
    }
  }
  return out;
}

/** Replace a report's adjustments (an empty list clears them all). */
export function setReportConsumableAdjustments(
  db: DatabaseSync,
  code: string,
  adjustments: ConsumableAdjustment[],
): void {
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(consumableAdjustmentKey(code), JSON.stringify(sanitizeAdjustments(adjustments)));
}

/* Per-report excluded pulls: the fight ids an officer switched off for a raid
   night, so a farm wipe or a gimmick pull stops skewing the night's numbers.
   Same meta-table pattern as prices — absent means "every pull counts". */

const excludedFightsKey = (code: string) => `excluded_fights:${code}`;

function sanitizeFightIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const ids = raw.filter((v): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0);
  return [...new Set(ids)].sort((a, b) => a - b);
}

/** The pulls excluded from one report's rollups (empty when the raid counts them all). */
export function getReportExcludedFights(db: DatabaseSync, code: string): number[] {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(excludedFightsKey(code)) as
    | { value: string }
    | undefined;
  if (!row) return [];
  try {
    return sanitizeFightIds(JSON.parse(row.value));
  } catch {
    return [];
  }
}

/**
 * Every report's excluded pulls, keyed by report code — one query, so a rollup
 * over many reports doesn't hit the meta table per report.
 */
export function getAllExcludedFights(db: DatabaseSync): Record<string, number[]> {
  const rows = db
    .prepare("SELECT key, value FROM meta WHERE key LIKE 'excluded_fights:%'")
    .all() as { key: string; value: string }[];
  const out: Record<string, number[]> = {};
  for (const { key, value } of rows) {
    try {
      out[key.slice("excluded_fights:".length)] = sanitizeFightIds(JSON.parse(value));
    } catch {
      // A hand-mangled blob just means "nothing excluded" for that report.
    }
  }
  return out;
}

/** Replace a report's excluded pulls (an empty list clears the filter). */
export function setReportExcludedFights(db: DatabaseSync, code: string, fightIds: number[]): void {
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(excludedFightsKey(code), JSON.stringify(sanitizeFightIds(fightIds)));
}

/* The council's loot policy: the factor weighting, and per-item overrides of
   the seeded spec priority sheet. Both are settings rather than entities —
   the weighting lives in meta, the overrides in their own small table. */

const POLICY_KEY = "guild_policy";

/** A number the officer may set, clamped to a range that can't break a ranking. */
function num(raw: unknown, min: number, max: number, round?: "int"): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < min || raw > max) return undefined;
  return round === "int" ? Math.round(raw) : Math.round(raw * 100) / 100;
}

function group<T extends string>(
  raw: unknown,
  keys: readonly T[],
  read: (value: unknown) => number | boolean | string | undefined,
): Partial<Record<T, number | boolean | string>> | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const out: Partial<Record<T, number | boolean | string>> = {};
  for (const key of keys) {
    const value = read((raw as Record<string, unknown>)[key]);
    if (value !== undefined) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Drop anything a hand-edited or stale blob shouldn't be able to do.
 *
 * Every field is optional on the way in and on the way out: a policy that only
 * names one number is valid, and the resolver fills the rest from the code
 * defaults. Junk is discarded rather than rejected, so one bad key can never
 * take a working policy — or a page — down with it.
 */
function isObject(raw: unknown): raw is Record<string, unknown> {
  return raw !== null && typeof raw === "object";
}

/** The boolean `preparation.coverage` replaced, if a stored policy still has it. */
function legacyElixirCounts(raw: unknown): boolean | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const value = (raw as Record<string, unknown>).elixirCounts;
  return typeof value === "boolean" ? value : undefined;
}

function sanitizePolicy(raw: unknown): Record<string, unknown> {
  if (raw === null || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  const weights = group(r.weights, ["attendance", "lootDebt", "performance", "preparation"] as const,
    (v) => num(v, 0, 100, "int"));
  if (weights) out.weights = weights;

  // Multipliers, not percentages: 0 would zero a contender out entirely, which
  // is a ban rather than a ranking, so the floor is deliberately above it.
  const standing = group(r.standing, ["main", "trial", "alt", "inactive", "pug"] as const,
    (v) => num(v, 0.01, 1));
  if (standing) out.standing = standing;

  const slotServed = group(r.slotServed, ["drop", "floor", "fillerDrop", "offListDrop"] as const,
    (v) => num(v, 0, 1));
  if (slotServed) out.slotServed = slotServed;

  // Two shapes in one group: the windows are numbers, `basis` is an enum, so
  // it cannot ride through `num` — a field this allowlist doesn't name is
  // dropped on read, and the editor would save it with no error anywhere.
  const attendance: Record<string, unknown> = {
    ...group(r.attendance, ["recentRaids", "weeks"] as const, (v) => num(v, 1, 100, "int")),
    ...group(r.attendance, ["basis"] as const,
      (v) => (v === "raid" || v === "week" ? v : undefined)),
  };
  if (Object.keys(attendance).length > 0) out.attendance = attendance;

  const perf = group(r.performance, ["parseMetric"] as const,
    (v) => (v === "all" || v === "bracket" ? v : undefined));
  if (perf) out.performance = perf;

  const loot = group(r.loot, ["altsContend"] as const,
    (v) => (typeof v === "boolean" ? v : undefined));
  if (loot) out.loot = loot;

  const preparation: Record<string, unknown> = {
    ...group(r.preparation, ["coverage"] as const,
      (v) => (v === "any" || v === "full" || v === "flaskOnly" ? v : undefined)),
  };
  // The excused-encounter list is names, not a number, so it can't go through
  // `group`. Bounded on both axes: a blob with ten thousand of them is junk,
  // and every entry is compared against a boss name from a log.
  const excused = (r.preparation as Record<string, unknown> | undefined)?.excusedEncounters;
  if (Array.isArray(excused)) {
    preparation.excusedEncounters = [
      ...new Set(
        excused
          .filter((v): v is string => typeof v === "string")
          .map((v) => v.trim())
          .filter((v) => v.length > 0 && v.length <= 80),
      ),
    ].slice(0, 200);
  }
  if (Object.keys(preparation).length > 0) out.preparation = preparation;
  else if (legacyElixirCounts(r.preparation) !== undefined) {
    // The field this replaced was a boolean, "does an elixir count at all".
    // A stored `false` was a real decision by an officer, so carry it to the
    // mode that means the same thing rather than dropping it back to default.
    out.preparation = { coverage: legacyElixirCounts(r.preparation) ? "any" : "flaskOnly" };
  }

  // Nested, unlike every other group: the weights are a record inside the
  // record. Sanitize both halves or a junk weight reaches a ranking.
  if (isObject(r.roster)) {
    const roster: Record<string, unknown> = {};
    const rosterWeights = group(
      (r.roster as Record<string, unknown>).weights,
      ["attendance", "performance", "preparation"] as const,
      (v) => num(v, 0, 100, "int"),
    );
    if (rosterWeights) roster.weights = rosterWeights;
    const minRaids = num((r.roster as Record<string, unknown>).minRaids, 0, 100, "int");
    if (minRaids !== undefined) roster.minRaids = minRaids;
    if (Object.keys(roster).length > 0) out.roster = roster;
  }

  const severity = group(r.improvementSeverity, ["high", "medium", "low"] as const,
    (v) => num(v, 0, 1000, "int"));
  if (severity) out.improvementSeverity = severity;

  return out;
}

/** The council's policy. Empty means the code defaults are in force. */
export function getGuildPolicy(db: DatabaseSync): Record<string, unknown> {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(POLICY_KEY) as
    | { value: string }
    | undefined;
  if (!row) return {};
  try {
    return sanitizePolicy(JSON.parse(row.value));
  } catch {
    return {};
  }
}

/** Replace the policy. An empty object hands everything back to the defaults. */
export function setGuildPolicy(db: DatabaseSync, policy: unknown): void {
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(POLICY_KEY, JSON.stringify(sanitizePolicy(policy)));
}

const SHEET_ITEM_IDS_KEY = "sheet_item_ids";

/**
 * Item ids an officer pinned to a name the priority sheet uses.
 *
 * The sheet is written in names and everything else here is keyed by id, so a
 * name Wowhead can't identify renders as bare text — no icon, no hover — on the
 * page officers read while deciding a drop. Most are closed automatically by
 * exact-name lookup; these are the ones that can't be:
 *
 *  - Two items share a name exactly. Both Warglaives of Azzinoth are called
 *    "Warglaive of Azzinoth", and the sheet tells them apart with "(Main Hand)"
 *    — an annotation no index can resolve. Only a person knows which is which.
 *  - The sheet's spelling is simply not the item's, and correcting the document
 *    isn't wanted.
 *
 * Guild-wide and keyed by the normalized name, so it survives the sheet being
 * re-pasted — which is the whole point: an officer should not have to redo this
 * every phase.
 */
export function getSheetItemIds(db: DatabaseSync): Record<string, number> {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(SHEET_ITEM_IDS_KEY) as
    | { value: string }
    | undefined;
  if (!row) return {};
  try {
    const raw = JSON.parse(row.value) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "number" && Number.isInteger(value) && value > 0) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/** Pin one name to an item id, or unpin it with `undefined`. */
export function setSheetItemId(db: DatabaseSync, key: string, itemId?: number): void {
  const current = getSheetItemIds(db);
  if (itemId === undefined) delete current[key];
  else current[key] = itemId;
  if (Object.keys(current).length === 0) {
    db.prepare("DELETE FROM meta WHERE key = ?").run(SHEET_ITEM_IDS_KEY);
    return;
  }
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(SHEET_ITEM_IDS_KEY, JSON.stringify(current));
}

export interface StoredPriorityRule {
  itemName: string;
  chain: string;
  note?: string;
}

/**
 * Every officer-edited chain, by phase and then normalized item name.
 *
 * Nested rather than flat-keyed on `"phase|name"`: the sheet page wants one
 * phase's chains whole, and a single-drop lookup walks the phases in order,
 * so both callers want a phase's worth at a time.
 */
export function getItemPriorityRules(db: DatabaseSync): Record<number, Record<string, StoredPriorityRule>> {
  const rows = db.prepare("SELECT item_key, phase, item_name, chain, note FROM item_priority_rules").all() as {
    item_key: string;
    phase: number;
    item_name: string;
    chain: string;
    note: string | null;
  }[];
  const out: Record<number, Record<string, StoredPriorityRule>> = {};
  for (const r of rows) {
    (out[r.phase] ??= {})[r.item_key] = {
      itemName: r.item_name,
      chain: r.chain,
      note: r.note ?? undefined,
    };
  }
  return out;
}

export function setItemPriorityRule(
  db: DatabaseSync,
  itemKey: string,
  phase: number,
  rule: StoredPriorityRule,
): void {
  db.prepare(
    `INSERT INTO item_priority_rules (item_key, phase, item_name, chain, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(item_key, phase) DO UPDATE SET
       item_name = excluded.item_name, chain = excluded.chain,
       note = excluded.note, updated_at = excluded.updated_at`,
  ).run(itemKey, phase, rule.itemName, rule.chain, rule.note ?? null, new Date().toISOString());
}

/** One phase's chain for an item, or undefined when that phase has none. */
export function getItemPriorityRuleAt(
  db: DatabaseSync,
  itemKey: string,
  phase: number,
): StoredPriorityRule | undefined {
  const row = db
    .prepare("SELECT item_name, chain, note FROM item_priority_rules WHERE item_key = ? AND phase = ?")
    .get(itemKey, phase) as { item_name: string; chain: string; note: string | null } | undefined;
  return row ? { itemName: row.item_name, chain: row.chain, note: row.note ?? undefined } : undefined;
}

/** Re-file a chain under another phase, keeping the text and the note as written. */
export function moveItemPriorityRule(
  db: DatabaseSync,
  itemKey: string,
  fromPhase: number,
  toPhase: number,
): void {
  db.prepare("UPDATE item_priority_rules SET phase = ? WHERE item_key = ? AND phase = ?").run(
    toPhase,
    itemKey,
    fromPhase,
  );
}

/**
 * Drop one phase's override so that phase's sheet takes the item back.
 *
 * Phase-scoped on purpose: clearing a chain on the P2 page must not silently
 * throw away the different chain an officer wrote for the same item in P3.
 */
export function deleteItemPriorityRule(db: DatabaseSync, itemKey: string, phase: number): boolean {
  return (
    Number(
      db.prepare("DELETE FROM item_priority_rules WHERE item_key = ? AND phase = ?").run(itemKey, phase).changes,
    ) > 0
  );
}

export interface StoredWishlistAlternative {
  characterId: string;
  phase: number;
  slot: string;
  itemId: number;
  itemName?: string;
  rank: number;
  note?: string;
}

export function getWishlistAlternatives(db: DatabaseSync): StoredWishlistAlternative[] {
  const rows = db
    .prepare(
      "SELECT character_id, phase, slot, item_id, item_name, rank, note FROM wishlist_alternatives ORDER BY rank, item_id",
    )
    .all() as {
    character_id: string;
    phase: number;
    slot: string;
    item_id: number;
    item_name: string | null;
    rank: number;
    note: string | null;
  }[];
  return rows.map((r) => ({
    characterId: r.character_id,
    phase: r.phase,
    slot: r.slot,
    itemId: r.item_id,
    itemName: r.item_name ?? undefined,
    rank: r.rank,
    note: r.note ?? undefined,
  }));
}

export function setWishlistAlternative(
  db: DatabaseSync,
  alt: StoredWishlistAlternative,
): void {
  db.prepare(
    `INSERT INTO wishlist_alternatives
       (character_id, phase, slot, item_id, item_name, rank, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(character_id, phase, slot, item_id) DO UPDATE SET
       item_name = excluded.item_name, rank = excluded.rank,
       note = excluded.note, updated_at = excluded.updated_at`,
  ).run(
    alt.characterId,
    alt.phase,
    alt.slot,
    alt.itemId,
    alt.itemName ?? null,
    alt.rank,
    alt.note ?? null,
    new Date().toISOString(),
  );
}

export function deleteWishlistAlternative(
  db: DatabaseSync,
  characterId: string,
  phase: number,
  slot: string,
  itemId: number,
): boolean {
  return (
    Number(
      db
        .prepare(
          "DELETE FROM wishlist_alternatives WHERE character_id = ? AND phase = ? AND slot = ? AND item_id = ?",
        )
        .run(characterId, phase, slot, itemId).changes,
    ) > 0
  );
}

export interface StoredGuide {
  /** 'class' | 'raid'. */
  kind: string;
  /** 'Warrior', 'Black Temple'. */
  subject: string;
  /** '' for the subject itself, else 'Fury' or 'Supremus'. */
  section: string;
  /** 'operator' for the shared baseline, else the guild's id. */
  owner: string;
  body: string;
  sources: string[];
  author?: string;
  updatedAt: string;
}

const splitSources = (raw: string | null): string[] =>
  (raw ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

export function getGuides(db: DatabaseSync): StoredGuide[] {
  const rows = db
    .prepare("SELECT kind, subject, section, owner, body, sources, author, updated_at FROM guides")
    .all() as {
    kind: string;
    subject: string;
    section: string;
    owner: string;
    body: string;
    sources: string | null;
    author: string | null;
    updated_at: string;
  }[];
  return rows.map((r) => ({
    kind: r.kind,
    subject: r.subject,
    section: r.section,
    owner: r.owner,
    body: r.body,
    sources: splitSources(r.sources),
    author: r.author ?? undefined,
    updatedAt: r.updated_at,
  }));
}

export function setGuide(
  db: DatabaseSync,
  guide: {
    kind: string;
    subject: string;
    section: string;
    owner: string;
    body: string;
    sources: string[];
    author?: string;
  },
): void {
  db.prepare(
    `INSERT INTO guides (kind, subject, section, owner, body, sources, author, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(kind, subject, section, owner) DO UPDATE SET
       body = excluded.body, sources = excluded.sources,
       author = excluded.author, updated_at = excluded.updated_at`,
  ).run(
    guide.kind,
    guide.subject,
    guide.section,
    guide.owner,
    guide.body,
    guide.sources.join("\n") || null,
    guide.author ?? null,
    new Date().toISOString(),
  );
}

/** Remove a guide entirely — an empty one would read as "we have nothing to say". */
export function deleteGuide(
  db: DatabaseSync,
  kind: string,
  subject: string,
  section: string,
  owner: string,
): boolean {
  return (
    Number(
      db
        .prepare("DELETE FROM guides WHERE kind = ? AND subject = ? AND section = ? AND owner = ?")
        .run(kind, subject, section, owner).changes,
    ) > 0
  );
}

/** A pasted sheet, as stored. The markdown is kept verbatim, never pre-parsed. */
export interface StoredPrioritySheet {
  markdown: string;
  author?: string;
  note?: string;
  updatedAt: string;
}

/** Every pasted sheet, keyed by phase. Phases with none are simply absent. */
export function getPrioritySheets(db: DatabaseSync): Record<number, StoredPrioritySheet> {
  const rows = db
    .prepare("SELECT phase, markdown, author, note, updated_at FROM priority_sheets")
    .all() as {
    phase: number;
    markdown: string;
    author: string | null;
    note: string | null;
    updated_at: string;
  }[];
  const out: Record<number, StoredPrioritySheet> = {};
  for (const r of rows) {
    out[r.phase] = {
      markdown: r.markdown,
      author: r.author ?? undefined,
      note: r.note ?? undefined,
      updatedAt: r.updated_at,
    };
  }
  return out;
}

export function setPrioritySheet(
  db: DatabaseSync,
  phase: number,
  sheet: { markdown: string; author?: string; note?: string },
): void {
  db.prepare(
    `INSERT INTO priority_sheets (phase, markdown, author, note, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(phase) DO UPDATE SET
       markdown = excluded.markdown, author = excluded.author,
       note = excluded.note, updated_at = excluded.updated_at`,
  ).run(phase, sheet.markdown, sheet.author ?? null, sheet.note ?? null, new Date().toISOString());
}

/** Drop a pasted sheet, handing the phase back to the seed (or to empty). */
export function deletePrioritySheet(db: DatabaseSync, phase: number): boolean {
  return Number(db.prepare("DELETE FROM priority_sheets WHERE phase = ?").run(phase).changes) > 0;
}

/** Every enchant id the app has resolved a name for. */
export function getEnchantNames(db: DatabaseSync): Record<number, string> {
  const rows = db.prepare("SELECT id, name FROM enchant_names").all() as {
    id: number;
    name: string;
  }[];
  const out: Record<number, string> = {};
  for (const r of rows) out[r.id] = r.name;
  return out;
}

/**
 * Record resolved enchant names. A name already known is left alone: the first
 * one recorded is as good as any later one, and nothing should churn.
 */
export function addEnchantNames(db: DatabaseSync, names: { id: number; name: string }[]): number {
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO enchant_names (id, name, resolved_at) VALUES (?, ?, ?)",
  );
  const at = new Date().toISOString();
  let written = 0;
  for (const { id, name } of names) {
    if (!Number.isInteger(id) || id <= 0 || !name.trim()) continue;
    written += Number(stmt.run(id, name.trim(), at).changes);
  }
  return written;
}

/** One name Wowhead was asked about and would not identify. */
export interface RefusedItemName {
  nameKey: string;
  name: string;
  reason: string;
  near: string[];
  checkedAt: string;
}

/** Every name the app has asked about and been refused. */
export function getRefusedItemNames(db: DatabaseSync): RefusedItemName[] {
  const rows = db
    .prepare("SELECT name_key, name, reason, near, checked_at FROM item_name_lookups")
    .all() as { name_key: string; name: string; reason: string; near: string; checked_at: string }[];
  return rows.map((r) => ({
    nameKey: r.name_key,
    name: r.name,
    reason: r.reason,
    near: parseNear(r.near),
    checkedAt: r.checked_at,
  }));
}

/** A malformed blob is nothing offered, never a thrown read. */
function parseNear(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Record names Wowhead refused, replacing any earlier verdict on the same name.
 *
 * Replacing rather than ignoring: a re-ask is how an officer checks whether a
 * fixed sheet row now resolves, and the newer answer is the true one. Callers
 * must filter out transport errors before getting here — see the table comment.
 */
export function recordRefusedItemNames(
  db: DatabaseSync,
  refused: { nameKey: string; name: string; reason: string; near: string[] }[],
): number {
  const stmt = db.prepare(
    `INSERT INTO item_name_lookups (name_key, name, reason, near, checked_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(name_key) DO UPDATE SET
       name = excluded.name, reason = excluded.reason,
       near = excluded.near, checked_at = excluded.checked_at`,
  );
  const at = new Date().toISOString();
  let written = 0;
  for (const r of refused) {
    if (!r.nameKey.trim() || !r.name.trim()) continue;
    written += Number(stmt.run(r.nameKey, r.name.trim(), r.reason, JSON.stringify(r.near), at).changes);
  }
  return written;
}

/**
 * Forget past refusals, so the ordinary queue offers those names again.
 *
 * With no keys, forgets all of them — the "look at these again" press after a
 * sheet has been corrected or a curated label has moved.
 */
export function clearRefusedItemNames(db: DatabaseSync, nameKeys?: string[]): number {
  if (nameKeys === undefined) {
    return Number(db.prepare("DELETE FROM item_name_lookups").run().changes);
  }
  const stmt = db.prepare("DELETE FROM item_name_lookups WHERE name_key = ?");
  let removed = 0;
  for (const key of nameKeys) removed += Number(stmt.run(key).changes);
  return removed;
}

/* Entity <-> row mapping. SQLite has no undefined: optionals become NULL and
   are stripped again on load so zod sees exactly the canonical shapes. */

type Row = Record<string, unknown>;

function opt<T>(v: T | null | undefined): T | undefined {
  return v === null || v === undefined ? undefined : v;
}

/**
 * Write the guild row.
 *
 * `visibility` is in the column list on purpose. This is INSERT OR REPLACE, so
 * every field the list omits is silently reset to its default on any write —
 * the same shape that quietly unclaimed characters when `membership_id` was
 * left off `insertCharacter`. Nothing calls this to *update* today (the seed
 * does, once, on a fresh database; `setActivePhase` and `setGuildVisibility`
 * use targeted UPDATEs), and carrying the field means it stays safe if somebody
 * ever does.
 */
function insertGuild(db: DatabaseSync, g: Guild): void {
  db.prepare(
    `INSERT OR REPLACE INTO guild (id, name, realm, faction, active_phase, visibility,
       succession_admin_days, succession_member_days) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    g.id, g.name, g.realm, g.faction, g.activePhase, g.visibility,
    g.successionAdminDays ?? null, g.successionMemberDays ?? null,
  );
}

/**
 * Set how long the guild tolerates silence from all of its owners.
 *
 * Not clamped here — `clampWindows` does that on every read, so a row that
 * arrived by hand or from an older release is brought into range rather than
 * trusted. Bumps, because the succession banner is derived.
 */
export function setSuccessionWindows(db: DatabaseSync, administrativeDays: number, memberDays: number): void {
  db.prepare("UPDATE guild SET succession_admin_days = ?, succession_member_days = ?").run(
    administrativeDays,
    memberDays,
  );
  bumpDataVersion(db);
}

/**
 * Rename a guild, or move it to another realm.
 *
 * A targeted UPDATE rather than `insertGuild`, which is INSERT OR REPLACE and
 * would reset every column its list omits. Identity only — the phase,
 * visibility and succession windows are separate decisions with separate
 * writers, and lumping them together is how one edit quietly undoes another.
 */
export function setGuildIdentity(
  db: DatabaseSync,
  input: { name: string; realm: string; faction: string },
): void {
  db.prepare("UPDATE guild SET name = ?, realm = ?, faction = ?").run(input.name, input.realm, input.faction);
  bumpDataVersion(db);
}

/** Change what this guild publishes. Bumps: the public profile is derived. */
export function setGuildVisibility(db: DatabaseSync, visibility: string): void {
  db.prepare("UPDATE guild SET visibility = ?").run(visibility);
  bumpDataVersion(db);
}

export function insertCharacter(db: DatabaseSync, c: Character): void {
  db.prepare(
    `INSERT OR REPLACE INTO characters (id, guild_id, name, class, spec, role, off_spec, off_spec_role, race, status, main_character_id, note, membership_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    c.id, c.guildId, c.name, c.class, c.spec, c.role, c.offSpec ?? null, c.offSpecRole ?? null,
    c.race ?? null, c.status, c.mainCharacterId ?? null, c.note ?? null, c.membershipId ?? null,
  );
}

export function insertAttendanceExemption(db: DatabaseSync, e: AttendanceExemption): void {
  db.prepare(
    `INSERT OR REPLACE INTO attendance_exemptions (character_id, week_start, note) VALUES (?, ?, ?)`,
  ).run(e.characterId, e.weekStart, e.note ?? null);
}

export function insertCharacterComment(db: DatabaseSync, c: CharacterComment): void {
  db.prepare(
    `INSERT OR REPLACE INTO character_comments (id, character_id, category, body, author, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(c.id, c.characterId, c.category, c.body, c.author ?? null, c.createdAt);
}

export function insertItemComment(db: DatabaseSync, c: ItemComment): void {
  db.prepare(
    `INSERT OR REPLACE INTO item_comments (id, item_id, character_id, voice, body, author, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(c.id, c.itemId, c.characterId ?? null, c.voice, c.body, c.author ?? null, c.createdAt);
}

export function deleteItemComment(db: DatabaseSync, id: string): boolean {
  return db.prepare("DELETE FROM item_comments WHERE id = ?").run(id).changes > 0;
}

export function insertBossComment(db: DatabaseSync, c: BossComment): void {
  db.prepare(
    `INSERT OR REPLACE INTO boss_comments (id, zone, boss_key, boss, body, author, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(c.id, c.zone, c.bossKey, c.boss, c.body, c.author ?? null, c.createdAt);
}

export function deleteBossComment(db: DatabaseSync, id: string): boolean {
  return db.prepare("DELETE FROM boss_comments WHERE id = ?").run(id).changes > 0;
}

/**
 * Upsert foundational drops. Idempotent by construction — the key is natural,
 * so re-importing the same table twice changes nothing.
 *
 * `item_id` is COALESCEd rather than overwritten: an operator writing a drop
 * table types names, and an id the resolver has already found must survive a
 * re-paste of the same names.
 */
export function upsertBossDrops(db: DatabaseSync, drops: BossDrop[]): number {
  const stmt = db.prepare(
    `INSERT INTO boss_drops (zone, boss_key, boss, item_key, item_name, item_id, slot_label, note, author, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(zone, boss_key, item_key) DO UPDATE SET
       boss       = excluded.boss,
       item_name  = excluded.item_name,
       item_id    = COALESCE(excluded.item_id, boss_drops.item_id),
       slot_label = COALESCE(excluded.slot_label, boss_drops.slot_label),
       note       = COALESCE(excluded.note, boss_drops.note),
       author     = COALESCE(excluded.author, boss_drops.author),
       updated_at = excluded.updated_at
     WHERE boss_drops.boss      IS NOT excluded.boss
        OR boss_drops.item_name IS NOT excluded.item_name
        OR (excluded.item_id    IS NOT NULL AND boss_drops.item_id    IS NULL)
        OR (excluded.slot_label IS NOT NULL AND boss_drops.slot_label IS NULL)
        OR (excluded.note       IS NOT NULL AND boss_drops.note       IS NULL)`,
  );
  let written = 0;
  for (const d of drops) {
    written += Number(
      stmt.run(
        d.zone, d.bossKey, d.boss, d.itemKey, d.itemName, d.itemId ?? null,
        d.slotLabel ?? null, d.note ?? null, d.author ?? null, d.updatedAt,
      ).changes,
    ) > 0 ? 1 : 0;
  }
  return written;
}

export function deleteBossDrop(db: DatabaseSync, zone: string, bossKey: string, itemKey: string): boolean {
  return db
    .prepare("DELETE FROM boss_drops WHERE zone = ? AND boss_key = ? AND item_key = ?")
    .run(zone, bossKey, itemKey).changes > 0;
}

export function upsertGuildBossDrop(db: DatabaseSync, d: GuildBossDrop): void {
  db.prepare(
    `INSERT OR REPLACE INTO guild_boss_drops
       (guild_id, zone, boss_key, boss, item_key, item_name, item_id, action, slot_label, note, author, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    d.guildId, d.zone, d.bossKey, d.boss, d.itemKey, d.itemName, d.itemId ?? null,
    d.action, d.slotLabel ?? null, d.note ?? null, d.author ?? null, d.updatedAt,
  );
}

export function deleteGuildBossDrop(
  db: DatabaseSync, guildId: string, zone: string, bossKey: string, itemKey: string,
): boolean {
  return db
    .prepare("DELETE FROM guild_boss_drops WHERE guild_id = ? AND zone = ? AND boss_key = ? AND item_key = ?")
    .run(guildId, zone, bossKey, itemKey).changes > 0;
}

export function insertFeedback(db: DatabaseSync, f: FeedbackReport): void {
  db.prepare(
    `INSERT OR REPLACE INTO feedback
       (id, kind, reporter, body, route, url, context_json, status, priority, admin_note,
        admin_note_author, admin_note_at, resolved_by, resolved_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    f.id, f.kind, f.reporter ?? null, f.body, f.route, f.url,
    f.context ? JSON.stringify(f.context) : null, f.status, f.priority,
    f.adminNote ?? null, f.adminNoteAuthor ?? null, f.adminNoteAt ?? null,
    f.resolvedBy ?? null, f.resolvedAt ?? null, f.createdAt,
  );
}

/* ---------------------------------------------------------------------------
 * Identity.
 *
 * Split in two, and the split is the important part:
 *
 *   accounts / auth_sessions   NOT in the read model. Their writers below do
 *                              NOT call bumpDataVersion — a login must not
 *                              rebuild the whole in-memory model, and none of
 *                              this data appears in a derived view.
 *   everything else            ordinary guild data. Its writers bump like any
 *                              other write, because the read model serves it.
 *
 * Get that backwards and the app still works, which is why it is written down:
 * bumping on every session touch is a silent performance collapse under load,
 * and forgetting to bump on a membership change leaves the roster showing a
 * claim that is no longer there until the process restarts.
 * ------------------------------------------------------------------------- */

/** SHA-256, hex. Used for session cookies and invite codes — never the value itself. */
export function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function countAccounts(db: DatabaseSync): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number };
  return Number(row.n);
}

export function getAccount(db: DatabaseSync, id: string): Account | undefined {
  const row = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id) as Row | undefined;
  return row ? accountSchema.parse(rowToAccount(row)) : undefined;
}

/** The account for a Discord identity. One per identity. */
export function findAccountByDiscordId(db: DatabaseSync, discordId: string): Account | undefined {
  const row = db.prepare("SELECT * FROM accounts WHERE discord_id = ?").get(discordId) as Row | undefined;
  return row ? accountSchema.parse(rowToAccount(row)) : undefined;
}

/**
 * Record that this account was actually used.
 *
 * Signing in is not activity. A session lasts 30 days, so somebody who signs in
 * once and then uses the app daily would show `last_seen_at` from a month ago —
 * and every succession window is measured against that column. Without this the
 * inactivity rules fire on a guild's most active officers.
 *
 * Throttled by its caller (see `currentAccount`), because the alternative is a
 * write on every request. No version bump: accounts are outside the read model.
 */
export function touchAccountSeen(db: DatabaseSync, id: string, now: string): void {
  db.prepare("UPDATE accounts SET last_seen_at = ? WHERE id = ?").run(now, id);
}

/** When this membership's account was last seen. Null when it never has been. */
export function membershipLastSeen(db: DatabaseSync, membershipId: string): string | null {
  const row = db
    .prepare(
      `SELECT a.last_seen_at AS seen FROM memberships m
       JOIN accounts a ON a.id = m.account_id WHERE m.id = ?`,
    )
    .get(membershipId) as Row | undefined;
  return (row?.seen as string | null) ?? null;
}

/**
 * Last-seen for every membership in a guild, in one query.
 *
 * Lives here rather than in the read model because `accounts` is deliberately
 * outside it: a login writes `last_seen_at`, and if that bumped `data_version`
 * every sign-in would rebuild the whole in-memory store. Callers pay one small
 * query instead, and get a live answer rather than one frozen at rebuild time.
 */
export function membershipLastSeenByGuild(db: DatabaseSync, guildId: string): Record<string, string | null> {
  const rows = db
    .prepare(
      `SELECT m.id AS membership_id, a.last_seen_at AS seen FROM memberships m
       JOIN accounts a ON a.id = m.account_id WHERE m.guild_id = ?`,
    )
    .all(guildId) as Row[];
  return Object.fromEntries(rows.map((r) => [r.membership_id as string, (r.seen as string | null) ?? null]));
}

export interface DiscordIdentity {
  discordId: string;
  discordUsername?: string;
  avatarUrl?: string;
  now: string;
}

/**
 * The login write: create on first sight, refresh the display fields on every
 * sight.
 *
 * Discord names and avatars change and the stored copy is display-only — the
 * `discord_id` is the identity. **`app_admin` is never read or written here.**
 * Signing in is not a place where privilege changes, in either direction.
 */
export function upsertAccount(db: DatabaseSync, identity: DiscordIdentity): Account {
  const existing = findAccountByDiscordId(db, identity.discordId);
  if (existing) {
    db.prepare(
      "UPDATE accounts SET discord_username = ?, avatar_url = ?, last_seen_at = ? WHERE id = ?",
    ).run(identity.discordUsername ?? null, identity.avatarUrl ?? null, identity.now, existing.id);
    return {
      ...existing,
      discordUsername: identity.discordUsername,
      avatarUrl: identity.avatarUrl,
      lastSeenAt: identity.now,
    };
  }
  const account: Account = {
    id: `acc_${randomUUID()}`,
    discordId: identity.discordId,
    discordUsername: identity.discordUsername,
    avatarUrl: identity.avatarUrl,
    appAdmin: false,
    disabled: false,
    createdAt: identity.now,
    lastSeenAt: identity.now,
  };
  db.prepare(
    `INSERT INTO accounts (id, discord_id, discord_username, avatar_url, app_admin, disabled, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, 0, 0, ?, ?)`,
  ).run(
    account.id, account.discordId, account.discordUsername ?? null, account.avatarUrl ?? null,
    account.createdAt, account.lastSeenAt ?? null,
  );
  return account;
}

/**
 * Promote or demote a service operator.
 *
 * Says nothing about any guild. An operator who is also somebody's guild master
 * gets that power from their membership, not from this flag — the flag grants
 * nothing inside a guild at all. See decide() in src/lib/auth/can.ts.
 */
export function setAccountAppAdmin(db: DatabaseSync, id: string, appAdmin: boolean): void {
  db.prepare("UPDATE accounts SET app_admin = ? WHERE id = ?").run(appAdmin ? 1 : 0, id);
}

/**
 * How many people can still administer this deployment.
 *
 * The same shape as `guildOwnerIds` and for the same reason: dropping to zero
 * is the one state the service can enter and never leave. Nobody could reach
 * `/service` to grant the flag back, because reaching `/service` requires it —
 * and unlike a guild, there is no succession ladder underneath.
 */
export function countAppAdmins(db: DatabaseSync): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE app_admin = 1 AND disabled = 0").get() as { n: number };
  return Number(row.n);
}

export interface OpenBreakGlass {
  id: string;
  guildId: string;
  accountId: string;
  reason: string;
  openedAt: string;
  expiresAt: string;
}

/**
 * Open an override into a guild the operator is not a member of.
 *
 * Short by default and bounded hard. A break-glass that lasted a week would be
 * an operator account with permanent guild access wearing a scarier name, and
 * the whole point is that it is temporary, reasoned and visible.
 */
export const BREAK_GLASS_MAX_MINUTES = 120;

export function openBreakGlass(
  db: DatabaseSync,
  input: { guildId: string; accountId: string; reason: string; minutes: number; now?: string },
): OpenBreakGlass {
  const now = input.now ?? new Date().toISOString();
  const minutes = Math.min(BREAK_GLASS_MAX_MINUTES, Math.max(1, Math.round(input.minutes)));
  const row: OpenBreakGlass = {
    id: `bg_${randomUUID().slice(0, 12)}`,
    guildId: input.guildId,
    accountId: input.accountId,
    reason: input.reason.trim().slice(0, 300),
    openedAt: now,
    expiresAt: new Date(Date.parse(now) + minutes * 60_000).toISOString(),
  };
  db.prepare(
    `INSERT INTO break_glass (id, guild_id, account_id, reason, opened_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.guildId, row.accountId, row.reason, row.openedAt, row.expiresAt);
  return row;
}

/**
 * The operator's open, unexpired override for a guild, if there is one.
 *
 * Expiry is checked in the query rather than by a sweeper, so a forgotten
 * break-glass simply stops working — there is no state where somebody has to
 * remember to close it for the guild to be safe again.
 */
export function findOpenBreakGlass(
  db: DatabaseSync,
  accountId: string,
  guildId: string,
  now: string = new Date().toISOString(),
): OpenBreakGlass | undefined {
  const r = db
    .prepare(
      `SELECT * FROM break_glass
        WHERE account_id = ? AND guild_id = ? AND closed_at IS NULL AND expires_at > ?
        ORDER BY opened_at DESC LIMIT 1`,
    )
    .get(accountId, guildId, now) as Row | undefined;
  return r
    ? {
        id: r.id as string,
        guildId: r.guild_id as string,
        accountId: r.account_id as string,
        reason: r.reason as string,
        openedAt: r.opened_at as string,
        expiresAt: r.expires_at as string,
      }
    : undefined;
}

/** Close one early. Expiry already handles the forgotten case. */
export function closeBreakGlass(db: DatabaseSync, id: string, at: string = new Date().toISOString()): boolean {
  return Number(db.prepare("UPDATE break_glass SET closed_at = ? WHERE id = ? AND closed_at IS NULL").run(at, id).changes) > 0;
}

export interface AccountRow {
  id: string;
  discordUsername: string | null;
  appAdmin: boolean;
  disabled: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  /** Sessions that could still authenticate right now. */
  liveSessions: number;
  /**
   * How many guilds they belong to. A **count**, deliberately not the guilds
   * or what they hold in them: an operator administers the tenancy, and which
   * roles somebody has inside a guild is that guild's business (section 7).
   */
  guildCount: number;
}

/** Every account on this deployment, newest first. Service-level: no guild data. */
export function listAccounts(db: DatabaseSync): AccountRow[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.discord_username, a.app_admin, a.disabled, a.created_at, a.last_seen_at,
              (SELECT COUNT(*) FROM auth_sessions s
                WHERE s.account_id = a.id AND s.revoked_at IS NULL AND s.expires_at > ?) AS live_sessions,
              (SELECT COUNT(*) FROM memberships m WHERE m.account_id = a.id) AS guild_count
         FROM accounts a ORDER BY a.created_at DESC`,
    )
    .all(new Date().toISOString()) as Row[];
  return rows.map((r) => ({
    id: r.id as string,
    discordUsername: (r.discord_username as string | null) ?? null,
    appAdmin: r.app_admin === 1,
    disabled: r.disabled === 1,
    createdAt: r.created_at as string,
    lastSeenAt: (r.last_seen_at as string | null) ?? null,
    liveSessions: Number(r.live_sessions),
    guildCount: Number(r.guild_count),
  }));
}

export function setAccountDisabled(db: DatabaseSync, id: string, disabled: boolean): void {
  db.prepare("UPDATE accounts SET disabled = ? WHERE id = ?").run(disabled ? 1 : 0, id);
  // A disabled account keeps no live sessions, or disabling does nothing until
  // the cookie happens to expire.
  if (disabled) revokeAccountSessions(db, id);
}

export function createAuthSession(
  db: DatabaseSync,
  input: { tokenHash: string; accountId: string; createdAt: string; expiresAt: string; userAgent?: string },
): void {
  db.prepare(
    `INSERT INTO auth_sessions (id, account_id, created_at, expires_at, user_agent)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(input.tokenHash, input.accountId, input.createdAt, input.expiresAt, input.userAgent ?? null);
}

export function findAuthSession(db: DatabaseSync, tokenHash: string): AuthSession | undefined {
  const row = db.prepare("SELECT * FROM auth_sessions WHERE id = ?").get(tokenHash) as Row | undefined;
  return row ? authSessionSchema.parse(rowToAuthSession(row)) : undefined;
}

export function revokeAuthSession(db: DatabaseSync, tokenHash: string, at: string): void {
  // Kept rather than deleted: a row that is gone is indistinguishable from one
  // that never existed, and "this cookie was signed out" is worth being able to say.
  db.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(at, tokenHash);
}

export function revokeAccountSessions(db: DatabaseSync, accountId: string): number {
  const at = new Date().toISOString();
  return Number(
    db.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL").run(at, accountId).changes,
  );
}

/** Housekeeping: expired rows can never authenticate anything again. */
export function purgeExpiredAuthSessions(db: DatabaseSync, before: string): number {
  return Number(db.prepare("DELETE FROM auth_sessions WHERE expires_at < ?").run(before).changes);
}

/* --- Guild-data identity. These bump, because the read model serves them. --- */

export function insertGuildRole(db: DatabaseSync, role: GuildRole): void {
  db.prepare(
    `INSERT OR REPLACE INTO guild_roles (id, guild_id, name, colour, sort, capabilities_json, baseline)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(role.id, role.guildId, role.name, role.colour ?? null, role.sort, JSON.stringify(role.capabilities), role.baseline ? 1 : 0);
}

/**
 * Remove a role, and take it off everyone who held it.
 *
 * The second half is the part that fails silently if skipped: a membership
 * holding a deleted role id trips validateStore on the next read model rebuild,
 * which happens on some unrelated write minutes later and reads as a corrupt
 * database. The baseline role is undeletable — it is what every membership
 * falls back to.
 */
export function deleteGuildRole(db: DatabaseSync, id: string): { ok: boolean; error?: string } {
  const row = db.prepare("SELECT baseline FROM guild_roles WHERE id = ?").get(id) as Row | undefined;
  if (!row) return { ok: false, error: "That role no longer exists." };
  if (row.baseline === 1) return { ok: false, error: "The baseline role can't be deleted — edit what it grants instead." };
  for (const m of db.prepare("SELECT id, role_ids_json FROM memberships").all() as Row[]) {
    const ids = JSON.parse((m.role_ids_json as string | null) ?? "[]") as string[];
    if (!ids.includes(id)) continue;
    db.prepare("UPDATE memberships SET role_ids_json = ? WHERE id = ?").run(
      JSON.stringify(ids.filter((r) => r !== id)),
      m.id as string,
    );
  }
  db.prepare("DELETE FROM guild_roles WHERE id = ?").run(id);
  return { ok: true };
}

/**
 * Add a membership.
 *
 * A plain INSERT, **not** INSERT OR REPLACE, and that is the whole point. With
 * OR REPLACE, adding a second membership for an account that already has one
 * silently deletes the first — `memberships_one_per_guild` makes them conflict.
 * The characters that pointed at the deleted row keep pointing at it, and the
 * next read model rebuild throws `claimed by unknown membershipId`, which is a
 * hard boot failure on an unrelated write minutes later.
 *
 * So a duplicate is a loud constraint error instead. Callers that mean "this
 * person may already be a member" ask `findMembershipByAccount` first — which
 * is the honest shape for invite redemption anyway: rejoining should restore
 * the membership somebody already has, not mint a second one.
 */
export function insertMembership(db: DatabaseSync, m: Membership): void {
  db.prepare(
    `INSERT INTO memberships (id, guild_id, account_id, display_name, is_guild_master, role_ids_json, joined_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(m.id, m.guildId, m.accountId, m.displayName, m.isGuildMaster ? 1 : 0, JSON.stringify(m.roleIds), m.joinedAt);
}

export function getMembership(db: DatabaseSync, id: string): Membership | undefined {
  const row = db.prepare("SELECT * FROM memberships WHERE id = ?").get(id) as Row | undefined;
  return row ? membershipSchema.parse(rowToMembership(row)) : undefined;
}

export function findMembershipByAccount(
  db: DatabaseSync,
  guildId: string,
  accountId: string,
): Membership | undefined {
  const row = db
    .prepare("SELECT * FROM memberships WHERE guild_id = ? AND account_id = ?")
    .get(guildId, accountId) as Row | undefined;
  return row ? membershipSchema.parse(rowToMembership(row)) : undefined;
}

/**
 * Everyone who owns this guild. Usually one; never, after the first, zero.
 *
 * Ownership is plural because a single owner is a single point of failure the
 * guild cannot repair: no role grants ownership, so when the only owner goes
 * quiet nobody inside can appoint a replacement. Two or three co-owners turn
 * that from an emergency into a non-event.
 */
export function guildOwnerIds(db: DatabaseSync, guildId: string): string[] {
  return (
    db
      .prepare("SELECT id FROM memberships WHERE guild_id = ? AND is_guild_master = 1 ORDER BY joined_at")
      .all(guildId) as Row[]
  ).map((r) => r.id as string);
}

export function setMembershipRoles(db: DatabaseSync, id: string, roleIds: string[]): boolean {
  return (
    Number(
      db.prepare("UPDATE memberships SET role_ids_json = ? WHERE id = ?").run(JSON.stringify(roleIds), id).changes,
    ) > 0
  );
}

/**
 * Who is changing ownership, for the audit entry every such change writes.
 *
 * `membershipId` absent means the app admin is acting. That is a legitimate
 * operator job — appointing an owner is administering the tenancy, not reading
 * the guild's loot decisions — and the guild sees it either way.
 */
export interface OwnershipActor {
  membershipId?: string;
  name: string;
  reason?: string;
}

export type OwnershipResult = { ok: true } | { ok: false; error: string };

function auditOwnership(
  db: DatabaseSync,
  guildId: string,
  kind: string,
  actor: OwnershipActor,
  detail: string,
): void {
  insertGuildAuditEntry(db, {
    id: `aud_${randomUUID()}`,
    guildId,
    kind,
    actor: actor.name,
    reason: actor.reason,
    detail,
    at: new Date().toISOString(),
  });
}

/** Make a member a co-owner. Idempotent, and always audited. */
export function addGuildOwner(
  db: DatabaseSync,
  guildId: string,
  membershipId: string,
  actor: OwnershipActor,
): OwnershipResult {
  const target = db
    .prepare("SELECT guild_id, display_name, is_guild_master FROM memberships WHERE id = ?")
    .get(membershipId) as Row | undefined;
  if (!target) return { ok: false, error: "That member no longer exists." };
  if (target.guild_id !== guildId) return { ok: false, error: "That member belongs to a different guild." };
  if (target.is_guild_master === 1) return { ok: true };

  return withTx(db, () => {
    db.prepare("UPDATE memberships SET is_guild_master = 1 WHERE id = ?").run(membershipId);
    auditOwnership(db, guildId, "owner.added", actor, `${target.display_name as string} is now a guild owner.`);
    bumpDataVersion(db);
    return { ok: true as const };
  });
}

/**
 * Take ownership away.
 *
 * Three rules, and the reasons matter more than the code:
 *
 *   - **Never the last owner.** A guild with no owner cannot appoint one, so
 *     this is the single state it can enter and never leave.
 *   - **Stepping down is always allowed** (if you are not the last). Nobody is
 *     trapped owning a guild.
 *   - **One owner may only remove another if that other has gone quiet.**
 *     Otherwise co-ownership is a race to remove the other person first. Two
 *     active owners who disagree simply cannot remove each other — that is a
 *     guild's argument to have, not the app's to settle.
 *
 * The app admin (no `membershipId`) is exempt from the third rule, because
 * arbitrating exactly that stalemate is what an operator is for.
 */
export function removeGuildOwner(
  db: DatabaseSync,
  guildId: string,
  membershipId: string,
  actor: OwnershipActor,
  opts: { inactiveDays: number; now?: Date } = { inactiveDays: 30 },
): OwnershipResult {
  const owners = guildOwnerIds(db, guildId);
  if (!owners.includes(membershipId)) return { ok: false, error: "That member is not a guild owner." };
  if (owners.length <= 1) {
    return { ok: false, error: "A guild can't be left without an owner — add another one first." };
  }

  const selfService = actor.membershipId === membershipId;
  const byAnotherOwner = actor.membershipId !== undefined && !selfService;
  if (byAnotherOwner) {
    const seen = membershipLastSeen(db, membershipId);
    const now = (opts.now ?? new Date()).getTime();
    const quietMs = opts.inactiveDays * 24 * 60 * 60 * 1000;
    const parsed = seen ? Date.parse(seen) : Number.NaN;
    // Never seen counts as quiet: an owner who has not once signed in cannot be
    // the reason a guild stays stuck.
    const quiet = !Number.isFinite(parsed) || now - parsed >= quietMs;
    if (!quiet) {
      return {
        ok: false,
        error: `That owner is still active. An owner can only be removed after ${opts.inactiveDays} days of inactivity.`,
      };
    }
  }

  const label = db.prepare("SELECT display_name FROM memberships WHERE id = ?").get(membershipId) as Row;
  return withTx(db, () => {
    db.prepare("UPDATE memberships SET is_guild_master = 0 WHERE id = ?").run(membershipId);
    auditOwnership(
      db,
      guildId,
      selfService ? "owner.stepped-down" : "owner.removed",
      actor,
      `${label.display_name as string} is no longer a guild owner.`,
    );
    bumpDataVersion(db);
    return { ok: true as const };
  });
}

export function deleteMembership(
  db: DatabaseSync,
  id: string,
): { ok: true; unlinkedCharacters: number } | { ok: false; error: string } {
  // An owner is never removed as a side effect of removing a member. Ownership
  // has its own rules — the last one cannot go, and one owner cannot push
  // another out while they are still active — and none of them can be enforced
  // from here. Demote first, deliberately, then delete.
  const row = db.prepare("SELECT is_guild_master FROM memberships WHERE id = ?").get(id) as Row | undefined;
  if (!row) return { ok: false, error: "That member no longer exists." };
  if (row.is_guild_master === 1) {
    return { ok: false, error: "That member owns the guild. Remove their ownership first." };
  }

  return withTx(db, () => {
    const unlinked = Number(
      db.prepare("UPDATE characters SET membership_id = NULL WHERE membership_id = ?").run(id).changes,
    );
    db.prepare("DELETE FROM memberships WHERE id = ?").run(id);
    bumpDataVersion(db);
    return { ok: true as const, unlinkedCharacters: unlinked };
  });
}

/**
 * The claim on a character, read straight from the row.
 *
 * Deliberately not taken off the read model: `updateCharacter` has to carry
 * this value across an INSERT OR REPLACE, and a read model that has not caught
 * up yet would hand it a null and silently unclaim the character. Ownership is
 * a permission-relevant fact, so it comes from the source of truth.
 */
export function getCharacterMembershipId(db: DatabaseSync, characterId: string): string | null {
  const row = db.prepare("SELECT membership_id FROM characters WHERE id = ?").get(characterId) as Row | undefined;
  return (row?.membership_id as string | null) ?? null;
}

/** Claim a character for a membership, or hand it back with null. */
export function setCharacterMembership(db: DatabaseSync, characterId: string, membershipId: string | null): boolean {
  return (
    Number(db.prepare("UPDATE characters SET membership_id = ? WHERE id = ?").run(membershipId, characterId).changes) > 0
  );
}

/**
 * Store an invite. **Plain INSERT, never INSERT OR REPLACE.**
 *
 * `code_hash` is UNIQUE, and OR REPLACE resolves a unique conflict by *deleting
 * the conflicting row* — so a code collision would silently destroy somebody
 * else's live invite instead of failing. The same pattern on `memberships`
 * orphaned character claims and took a boot failure to find. A collision here
 * is vanishingly unlikely; it must still be loud rather than destructive.
 */
export function insertGuildInvite(db: DatabaseSync, invite: GuildInvite): void {
  db.prepare(
    `INSERT INTO guild_invites (id, guild_id, character_id, code_hash, role_ids_json, created_by, created_at, expires_at, redeemed_at, redeemed_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    invite.id, invite.guildId, invite.characterId, invite.codeHash, JSON.stringify(invite.roleIds),
    invite.createdBy, invite.createdAt, invite.expiresAt, invite.redeemedAt ?? null, invite.redeemedBy ?? null,
  );
}

export function findInviteByCodeHash(db: DatabaseSync, codeHash: string): GuildInvite | undefined {
  const row = db.prepare("SELECT * FROM guild_invites WHERE code_hash = ?").get(codeHash) as Row | undefined;
  return row ? guildInviteSchema.parse(rowToGuildInvite(row)) : undefined;
}

export function markInviteRedeemed(db: DatabaseSync, id: string, membershipId: string, at: string): void {
  db.prepare("UPDATE guild_invites SET redeemed_at = ?, redeemed_by = ? WHERE id = ?").run(at, membershipId, id);
}

export function deleteGuildInvite(db: DatabaseSync, id: string): boolean {
  return Number(db.prepare("DELETE FROM guild_invites WHERE id = ?").run(id).changes) > 0;
}

/**
 * Housekeeping: drop invitations that expired without ever being used.
 *
 * Redeemed rows are kept deliberately. They record who let whom into the guild,
 * which is exactly the kind of thing an officer has to be able to answer later
 * (invariant 6), and they cost nothing.
 */
export function purgeExpiredInvites(db: DatabaseSync, before: string): number {
  return Number(
    db.prepare("DELETE FROM guild_invites WHERE redeemed_at IS NULL AND expires_at < ?").run(before).changes,
  );
}

/**
 * Who a character is, for the code that decides access to them.
 *
 * Read from the row rather than the read model for the same reason
 * `getCharacterMembershipId` is: it decides whether an invite may be redeemed,
 * and a stale answer would either refuse a valid invite or accept one across a
 * guild boundary. The name rides along because every one of those decisions
 * gets written to the audit log, which is read by people — an entry naming
 * `chr_f31b8934…` records that something happened and not what.
 */
export function characterIdentity(
  db: DatabaseSync,
  characterId: string,
): { guildId: string; name: string } | null {
  const row = db.prepare("SELECT guild_id, name FROM characters WHERE id = ?").get(characterId) as Row | undefined;
  return row ? { guildId: row.guild_id as string, name: row.name as string } : null;
}

/** The roles a guild actually has right now. Roles are deletable; grants naming them are not. */
export function guildRoleIds(db: DatabaseSync, guildId: string): Set<string> {
  const rows = db.prepare("SELECT id FROM guild_roles WHERE guild_id = ?").all(guildId) as Row[];
  return new Set(rows.map((r) => r.id as string));
}

/**
 * Write something the guild is entitled to know about.
 *
 * Append-only by design: nothing here updates or deletes a row, because an
 * audit log an admin can edit is not an audit log.
 */
export function insertGuildAuditEntry(db: DatabaseSync, entry: GuildAuditEntry): void {
  db.prepare(
    `INSERT INTO guild_audit (id, guild_id, kind, actor, reason, detail, at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(entry.id, entry.guildId, entry.kind, entry.actor, entry.reason ?? null, entry.detail ?? null, entry.at, entry.expiresAt ?? null);
}

/**
 * Seed an item row verbatim. `verified` is left to its DEFAULT 0 on purpose:
 * the curated seed is a hand-written starting point, not Wowhead's answer, and
 * saying so is what lets the resolver come back and correct it later.
 */
function insertItem(db: DatabaseSync, i: Item): void {
  db.prepare(
    `INSERT OR REPLACE INTO items (id, name, quality, icon, slot, source_json, phase)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    i.id, i.name ?? null, i.quality ?? null, i.icon ?? null, i.slot ?? null,
    i.source ? JSON.stringify(i.source) : null, i.phase ?? null,
  );
}

/**
 * Fill the item cache from an import without ever overwriting what's already
 * known: a new row is inserted whole, an existing one only gains the fields it
 * was missing (COALESCE keeps the curated value). Returns how many rows were
 * created or learned something — nothing else touches the cache, so that count
 * is what the import panel reports.
 */
/**
 * Fold partial item knowledge into the cache. Two modes, and the difference
 * between them is provenance, not SQL:
 *
 * - **Filling gaps** (default) is for every local source — the curated seed, a
 *   name typed into a wishlist, an icon lifted off a log. A field already
 *   present always wins, so imports can run in any order without fighting.
 * - **Authoritative** is for `resolveItemsFromWowhead` and nothing else. It
 *   overwrites what it knows and stamps `verified`, because a guess that
 *   survived is exactly the bug this exists to fix.
 *
 * Even authoritative writes never *overwrite* `source_json` or `phase`: an
 * empty column is filled from Wowhead, a curated one still wins. An officer who
 * files a token under the phase their guild uses it in has made a decision, and
 * a backfill must not quietly overrule it. Both now come out of the item XML —
 * the phase from the tooltip markup, the zone and boss from its JSON block.
 *
 * With one exception, and it is the whole reason this got written. When an
 * unverified row's name and Wowhead's name for the same id disagree, the row
 * was never about this item — someone curated "Serpent Spine Longbow" onto the
 * id of a Barrel-Blade Longrifle. The zone, boss and phase written next to that
 * name describe the item the author meant, not the item the id is, so carrying
 * them across would pin a Karazhan drop onto a PvP glove and every phase filter
 * downstream would believe it. They are dropped instead: no source beats a
 * confident wrong one, and re-curating against a correct id is a person's job.
 *
 * Returns rows touched. In gap-filling mode that equals rows that learned
 * something, because the WHERE says so. An authoritative write always touches
 * every row it is given — it has a `verified` stamp to apply even when the
 * data already agreed — so a caller wanting "how many were actually wrong"
 * has to diff, which is what `saveResolvedItems` does.
 */
/**
 * "This row was curated onto the wrong id" — an unverified name that Wowhead
 * contradicts. Only ever true of a row nothing has confirmed: once verified,
 * both names came from the same place and cannot disagree.
 */
const MISIDENTIFIED = `items.verified = 0
  AND items.name IS NOT NULL
  AND excluded.name IS NOT NULL
  AND items.name <> excluded.name`;

/**
 * Withdraw the "Wowhead confirmed this" stamp from one row.
 *
 * The eight wrong-icon reports the council filed were all fixed by hand, one
 * lookup at a time, because a verified row is never asked about again — that is
 * the whole point of the stamp, and it is also how a wrong answer becomes
 * permanent. Clearing it puts the row back in the resolver's queue, where the
 * next backfill overwrites name, icon and quality with Wowhead's answer.
 *
 * Only the stamp. The row keeps its name and icon meanwhile (a placeholder would
 * make every list worse until the next press), and it keeps the guild's own
 * curation — zone, boss and phase are nobody else's to answer.
 */
export function unverifyItem(db: DatabaseSync, itemId: number): boolean {
  return (
    Number(db.prepare("UPDATE items SET verified = 0 WHERE id = ?").run(itemId).changes) > 0
  );
}

export function mergeItems(
  db: DatabaseSync,
  items: Item[],
  { authoritative = false }: { authoritative?: boolean } = {},
): number {
  const stmt = db.prepare(
    authoritative
      ? `INSERT INTO items (id, name, quality, icon, slot, source_json, phase, verified, armor_token, phase_checked)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 1)
         ON CONFLICT(id) DO UPDATE SET
           name        = COALESCE(excluded.name,    items.name),
           quality     = COALESCE(excluded.quality, items.quality),
           icon        = COALESCE(excluded.icon,    items.icon),
           /* "This is an armor token" is a positive statement that it has no
              slot, unlike the silence COALESCE exists to respect — and the
              shipped seed did invent slots for tokens. So this is the one
              field an authoritative answer may clear rather than only set. */
           slot        = CASE WHEN excluded.armor_token = 1 THEN NULL
                              ELSE COALESCE(excluded.slot, items.slot) END,
           armor_token = COALESCE(excluded.armor_token, items.armor_token),
           source_json = CASE WHEN ${MISIDENTIFIED} THEN NULL
                              ELSE COALESCE(items.source_json, excluded.source_json) END,
           phase       = CASE WHEN ${MISIDENTIFIED} THEN NULL
                              ELSE COALESCE(items.phase, excluded.phase) END,
           /* Asked and answered, even when the answer was "no phase". Without
              this the queue would hand back the same ids every press. */
           phase_checked = 1,
           verified    = 1`
      : `INSERT INTO items (id, name, quality, icon, slot, source_json, phase, verified)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET
           name        = COALESCE(items.name, excluded.name),
           quality     = COALESCE(items.quality, excluded.quality),
           icon        = COALESCE(items.icon, excluded.icon),
           slot        = COALESCE(items.slot, excluded.slot),
           source_json = COALESCE(items.source_json, excluded.source_json),
           phase       = COALESCE(items.phase, excluded.phase)
         WHERE (items.name        IS NULL AND excluded.name        IS NOT NULL)
            OR (items.quality     IS NULL AND excluded.quality     IS NOT NULL)
            OR (items.icon        IS NULL AND excluded.icon        IS NOT NULL)
            OR (items.slot        IS NULL AND excluded.slot        IS NOT NULL)
            OR (items.source_json IS NULL AND excluded.source_json IS NOT NULL)
            OR (items.phase       IS NULL AND excluded.phase       IS NOT NULL)`,
  );
  let learned = 0;
  for (const i of items) {
    const common = [
      i.id, i.name ?? null, i.quality ?? null, i.icon ?? null, i.slot ?? null,
      i.source ? JSON.stringify(i.source) : null, i.phase ?? null,
    ] as const;
    // `armor_token` rides the authoritative path only: Wowhead's subclass is
    // the sole source for it, and a gap-filling caller has nothing to say.
    const changes = authoritative
      ? stmt.run(...common, i.armorToken === undefined ? null : i.armorToken ? 1 : 0).changes
      : stmt.run(...common).changes;
    learned += Number(changes) > 0 ? 1 : 0;
  }
  return learned;
}

/** One tier piece and the armor token that buys it. */
export interface TokenRedemption {
  pieceId: number;
  tokenId: number;
}

/**
 * Record which token buys which tier piece, and mark the tokens as tokens.
 *
 * Overwrites, unlike `mergeItems`' gap-filling mode: Wowhead's vendor listing
 * is the only source for this edge and nothing else writes it, so an existing
 * value is an older reading of the same page rather than someone's answer to
 * protect. Rows are created if missing so an edge can be recorded for a piece
 * the cache has never seen — it arrives naming nothing but its id, and the
 * item resolver picks it up from `listUnresolvedItemIds` like any other.
 *
 * Returns the number of edges written.
 */
export function mergeTokenRedemptions(db: DatabaseSync, edges: TokenRedemption[]): number {
  const piece = db.prepare(
    `INSERT INTO items (id, redeems_from) VALUES (?, ?)
     ON CONFLICT(id) DO UPDATE SET redeems_from = excluded.redeems_from`,
  );
  const token = db.prepare(
    `INSERT INTO items (id, armor_token) VALUES (?, 1)
     ON CONFLICT(id) DO UPDATE SET armor_token = 1`,
  );
  const tokens = new Set<number>();
  let written = 0;
  for (const edge of edges) {
    if (!Number.isInteger(edge.pieceId) || !Number.isInteger(edge.tokenId)) continue;
    if (edge.pieceId <= 0 || edge.tokenId <= 0 || edge.pieceId === edge.tokenId) continue;
    piece.run(edge.pieceId, edge.tokenId);
    tokens.add(edge.tokenId);
    written++;
  }
  for (const id of tokens) token.run(id);
  return written;
}

export function insertGearSet(db: DatabaseSync, s: GearSet): void {
  db.prepare(
    `INSERT INTO gear_sets (id, character_id, kind, phase, name, source, source_url, imported_at, stats_json, slots_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    s.id, s.characterId, s.kind, s.phase ?? null, s.name, s.source, s.sourceUrl ?? null,
    s.importedAt, JSON.stringify(s.stats), JSON.stringify(s.slots),
  );
}

/** Pin one slot of one kit (replacing whatever was pinned there before). */
export function insertCurrentGearOverride(db: DatabaseSync, o: CurrentGearOverride): void {
  db.prepare(
    `INSERT OR REPLACE INTO current_gear_overrides (character_id, spec, slot, item_id, item_name, source, set_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(o.characterId, o.spec, o.item.slot, o.item.itemId, o.item.itemName, o.source, o.setAt);
}

export function insertRaidSession(db: DatabaseSync, s: RaidSession): void {
  db.prepare(
    "INSERT INTO raid_sessions (id, guild_id, date, zones_json, note, source) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(s.id, s.guildId, s.date, JSON.stringify(s.zones), s.note ?? null, s.source);
}

export function insertLootAward(db: DatabaseSync, a: LootAward): void {
  db.prepare(
    `INSERT INTO loot_awards (id, raid_session_id, character_id, raw_winner_name, item_id, item_name, awarded_at, offspec, external, note, decision_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    a.id, a.raidSessionId, a.characterId, a.rawWinnerName, a.itemId, a.itemName,
    a.awardedAt, a.offspec ? 1 : 0, a.external ? 1 : 0, a.note ?? null,
    a.decision ? JSON.stringify(a.decision) : null,
  );
}

export function insertWclReport(db: DatabaseSync, r: WclReport): void {
  db.prepare(
    // OR REPLACE, so every column belongs in this list — one left out is set
    // back to its default on each update rather than on insert. See §2.
    `INSERT OR REPLACE INTO wcl_reports
       (code, title, zone, start_time, end_time, fetched_at, upkeep_tracks_json,
        unclassified_auras_json, raid_session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    r.code,
    r.title,
    r.zone ?? null,
    r.startTime,
    r.endTime,
    r.fetchedAt,
    JSON.stringify(r.upkeepTracks ?? []),
    JSON.stringify(r.unclassifiedAuras ?? []),
    r.raidSessionId,
  );
}

export function insertWclPlayerFight(db: DatabaseSync, f: WclPlayerFight): void {
  db.prepare(
    `INSERT INTO wcl_player_fights (
       id, report_code, fight_id, encounter_id, encounter_name, kill, fight_percentage,
       duration_ms, actor_name, character_id, class_name, spec, role, parse_percent,
       bracket_percent, amount, deaths, flask, elixirs_json, scrolls_json, food, weapon_buff,
       prepot, prepot_label, death_times_json, potions_json, other_casts_json, extras_json, cooldowns_json, cast_times_json,
       upkeep_json, gear_json, talents_json, drums, runes, healthstones, sappers, missing_enchants_json, fight_start_ms,
       boss_parse_percent, boss_amount
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    f.id, f.reportCode, f.fightId, f.encounterId, f.encounterName, f.kill ? 1 : 0,
    f.fightPercentage ?? null, f.durationMs, f.actorName, f.characterId, f.className ?? null,
    f.spec ?? null, f.role, f.parsePercent ?? null, f.bracketPercent ?? null, f.amount ?? null,
    f.deaths, f.flask ?? null, JSON.stringify(f.elixirs), JSON.stringify(f.scrolls), f.food ? 1 : 0,
    f.weaponBuff ? 1 : 0, f.prepot ? 1 : 0, f.prepotLabel ?? null,
    JSON.stringify(f.deathTimes),
    JSON.stringify(f.potions), JSON.stringify(f.otherCasts),
    JSON.stringify(f.extras), JSON.stringify(f.cooldowns), JSON.stringify(f.castTimes),
    JSON.stringify(f.upkeep),
    JSON.stringify(f.gear), JSON.stringify(f.talents),
    f.drums, f.runes, f.healthstones, f.sappers, JSON.stringify(f.missingEnchants),
    f.fightStartMs ?? null, f.bossParsePercent ?? null, f.bossAmount ?? null,
  );
}

export function insertWclPlayerOffPull(db: DatabaseSync, o: WclPlayerOffPull): void {
  db.prepare(
    `INSERT OR REPLACE INTO wcl_player_offpull (
       id, report_code, actor_name, character_id, potions_json, other_casts_json,
       drums, runes, healthstones, sappers, pet_consumables_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    o.id, o.reportCode, o.actorName, o.characterId,
    JSON.stringify(o.potions), JSON.stringify(o.otherCasts),
    o.drums, o.runes, o.healthstones, o.sappers, JSON.stringify(o.petConsumables),
  );
}

function rowToWclPlayerOffPull(r: Row): unknown {
  return {
    id: r.id,
    reportCode: r.report_code,
    actorName: r.actor_name,
    characterId: (r.character_id as string | null) ?? null,
    potions: JSON.parse(r.potions_json as string),
    otherCasts: JSON.parse(r.other_casts_json as string),
    drums: r.drums,
    runes: r.runes,
    healthstones: r.healthstones,
    sappers: r.sappers,
    petConsumables: JSON.parse(r.pet_consumables_json as string),
  };
}

function rowToGuild(r: Row): unknown {
  return {
    id: r.id, name: r.name, realm: r.realm, faction: r.faction, activePhase: r.active_phase,
    // A database written before the column existed reads as null; the schema
    // default turns that into "private", which is the safe direction.
    visibility: (r.visibility as string | null) ?? undefined,
    successionAdminDays: (r.succession_admin_days as number | null) ?? undefined,
    successionMemberDays: (r.succession_member_days as number | null) ?? undefined,
  };
}

function rowToCharacter(r: Row): unknown {
  return {
    id: r.id, guildId: r.guild_id, name: r.name, class: r.class, spec: r.spec,
    role: r.role, offSpec: opt(r.off_spec), offSpecRole: opt(r.off_spec_role),
    race: opt(r.race), status: r.status,
    mainCharacterId: (r.main_character_id as string | null) ?? null, note: opt(r.note),
    membershipId: (r.membership_id as string | null) ?? null,
  };
}

/* Identity row mapping. JSON columns are owned lists, same as gear-set slots. */

function rowToMembership(r: Row): unknown {
  return {
    id: r.id, guildId: r.guild_id, accountId: r.account_id, displayName: r.display_name,
    isGuildMaster: r.is_guild_master === 1,
    roleIds: JSON.parse((r.role_ids_json as string | null) ?? "[]"),
    joinedAt: r.joined_at,
  };
}

function rowToGuildRole(r: Row): unknown {
  return {
    id: r.id, guildId: r.guild_id, name: r.name, colour: opt(r.colour), sort: r.sort,
    capabilities: JSON.parse((r.capabilities_json as string | null) ?? "[]"),
    baseline: r.baseline === 1,
  };
}

function rowToGuildInvite(r: Row): unknown {
  return {
    id: r.id, guildId: r.guild_id, characterId: r.character_id, codeHash: r.code_hash,
    roleIds: JSON.parse((r.role_ids_json as string | null) ?? "[]"),
    createdBy: r.created_by, createdAt: r.created_at, expiresAt: r.expires_at,
    redeemedAt: opt(r.redeemed_at), redeemedBy: opt(r.redeemed_by),
  };
}

function rowToGuildAudit(r: Row): unknown {
  return {
    id: r.id, guildId: r.guild_id, kind: r.kind, actor: r.actor, reason: opt(r.reason),
    detail: opt(r.detail), at: r.at, expiresAt: opt(r.expires_at),
  };
}

function rowToAccount(r: Row): unknown {
  return {
    id: r.id, discordId: r.discord_id, discordUsername: opt(r.discord_username),
    avatarUrl: opt(r.avatar_url), appAdmin: r.app_admin === 1, disabled: r.disabled === 1,
    createdAt: r.created_at, lastSeenAt: opt(r.last_seen_at),
  };
}

function rowToAuthSession(r: Row): unknown {
  return {
    id: r.id, accountId: r.account_id, createdAt: r.created_at, expiresAt: r.expires_at,
    revokedAt: opt(r.revoked_at), userAgent: opt(r.user_agent),
  };
}

function rowToAttendanceExemption(r: Row): unknown {
  return { characterId: r.character_id, weekStart: r.week_start, note: opt(r.note) };
}

function rowToCharacterComment(r: Row): unknown {
  return {
    id: r.id, characterId: r.character_id, category: r.category, body: r.body,
    author: opt(r.author), createdAt: r.created_at,
  };
}

function rowToItemComment(r: Row): unknown {
  return {
    id: r.id, itemId: r.item_id, characterId: opt(r.character_id), voice: r.voice,
    body: r.body, author: opt(r.author), createdAt: r.created_at,
  };
}

function rowToBossComment(r: Row): unknown {
  return {
    id: r.id, zone: r.zone, bossKey: r.boss_key, boss: r.boss,
    body: r.body, author: opt(r.author), createdAt: r.created_at,
  };
}

function rowToBossDrop(r: Row): unknown {
  return {
    zone: r.zone, bossKey: r.boss_key, boss: r.boss, itemKey: r.item_key,
    itemName: r.item_name, itemId: opt(r.item_id), slotLabel: opt(r.slot_label),
    note: opt(r.note), author: opt(r.author), updatedAt: r.updated_at,
  };
}

function rowToGuildBossDrop(r: Row): unknown {
  return { ...(rowToBossDrop(r) as object), guildId: r.guild_id, action: r.action };
}

function rowToFeedback(r: Row): unknown {
  return {
    id: r.id, kind: r.kind, reporter: opt(r.reporter), body: r.body, route: r.route, url: r.url,
    context: r.context_json ? JSON.parse(r.context_json as string) : undefined,
    status: r.status, priority: r.priority, adminNote: opt(r.admin_note),
    adminNoteAuthor: opt(r.admin_note_author), adminNoteAt: opt(r.admin_note_at),
    resolvedBy: opt(r.resolved_by), resolvedAt: opt(r.resolved_at),
    createdAt: r.created_at,
  };
}

function rowToItem(r: Row): unknown {
  return {
    id: r.id, name: opt(r.name), quality: opt(r.quality), icon: opt(r.icon), slot: opt(r.slot),
    source: r.source_json ? JSON.parse(r.source_json as string) : undefined,
    phase: opt(r.phase),
    verified: r.verified === 1,
    // Three-valued on purpose: undefined is "never asked", false is "asked,
    // and it's an ordinary item". `=== 1` alone would flatten them into one.
    armorToken: r.armor_token === null || r.armor_token === undefined ? undefined : r.armor_token === 1,
    redeemsFrom: opt(r.redeems_from),
    phaseChecked: r.phase_checked === 1,
  };
}

function rowToGearSet(r: Row): unknown {
  return {
    id: r.id, characterId: r.character_id, kind: r.kind, phase: opt(r.phase),
    name: r.name, source: r.source, sourceUrl: opt(r.source_url), importedAt: r.imported_at,
    stats: JSON.parse(r.stats_json as string), slots: JSON.parse(r.slots_json as string),
  };
}

function rowToCurrentGearOverride(r: Row): unknown {
  return {
    characterId: r.character_id,
    item: { slot: r.slot, itemId: r.item_id, itemName: r.item_name },
    source: r.source,
    spec: r.spec ?? "main",
    setAt: r.set_at,
  };
}

function rowToRaidSession(r: Row): unknown {
  return {
    id: r.id, guildId: r.guild_id, date: r.date, zones: JSON.parse(r.zones_json as string),
    note: opt(r.note), source: r.source,
  };
}

function rowToLootAward(r: Row): unknown {
  return {
    id: r.id, raidSessionId: r.raid_session_id, characterId: (r.character_id as string | null) ?? null,
    external: r.external === 1, rawWinnerName: r.raw_winner_name, itemId: r.item_id, itemName: r.item_name,
    awardedAt: r.awarded_at, offspec: r.offspec === 1, note: opt(r.note),
    decision: parseDecision(r.decision_json),
  };
}

/**
 * A stored snapshot, or undefined. Never throws: a decision that can't be read
 * back is a lost explanation, not a reason to fail the whole ledger.
 */
function parseDecision(raw: unknown): unknown {
  if (typeof raw !== "string" || raw === "") return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function rowToWclReport(r: Row): unknown {
  return {
    code: r.code, title: r.title, zone: opt(r.zone), startTime: r.start_time,
    endTime: r.end_time, fetchedAt: r.fetched_at,
    upkeepTracks: JSON.parse((r.upkeep_tracks_json as string | null) ?? "[]"),
    unclassifiedAuras: JSON.parse((r.unclassified_auras_json as string | null) ?? "[]"),
    raidSessionId: (r.raid_session_id as string | null) ?? null,
  };
}

function rowToWclPlayerFight(r: Row): unknown {
  return {
    id: r.id, reportCode: r.report_code, fightId: r.fight_id, encounterId: r.encounter_id,
    encounterName: r.encounter_name, kill: r.kill === 1, fightPercentage: opt(r.fight_percentage),
    durationMs: r.duration_ms, fightStartMs: opt(r.fight_start_ms), actorName: r.actor_name,
    characterId: (r.character_id as string | null) ?? null,
    className: opt(r.class_name), spec: opt(r.spec), role: r.role,
    parsePercent: opt(r.parse_percent), bracketPercent: opt(r.bracket_percent),
    bossParsePercent: opt(r.boss_parse_percent), bossAmount: opt(r.boss_amount),
    amount: opt(r.amount), deaths: r.deaths, flask: opt(r.flask),
    elixirs: JSON.parse(r.elixirs_json as string),
    scrolls: JSON.parse((r.scrolls_json as string | null) ?? "[]"), food: r.food === 1,
    weaponBuff: r.weapon_buff === 1, prepot: r.prepot === 1,
    prepotLabel: opt(r.prepot_label),
    deathTimes: JSON.parse((r.death_times_json as string | null) ?? "[]"),
    potions: JSON.parse(r.potions_json as string),
    otherCasts: JSON.parse((r.other_casts_json as string | null) ?? "[]"),
    extras: JSON.parse((r.extras_json as string | null) ?? "[]"),
    cooldowns: JSON.parse((r.cooldowns_json as string | null) ?? "[]"),
    castTimes: JSON.parse((r.cast_times_json as string | null) ?? "[]"),
    upkeep: JSON.parse((r.upkeep_json as string | null) ?? "[]"),
    gear: JSON.parse((r.gear_json as string | null) ?? "[]"),
    talents: JSON.parse((r.talents_json as string | null) ?? "[]"),
    drums: r.drums, runes: r.runes,
    healthstones: r.healthstones, sappers: r.sappers ?? 0,
    missingEnchants: JSON.parse(r.missing_enchants_json as string),
  };
}

function parseAll<T>(label: string, schema: { parse: (d: unknown) => T }, rows: unknown[]): T[] {
  return rows.map((row) => {
    try {
      return schema.parse(row);
    } catch (e) {
      throw new Error(`SQLite row invalid (${label}): ${e instanceof Error ? e.message : String(e)}`);
    }
  });
}

export function loadStore(db: DatabaseSync): EntityStore {
  const guildRow = db.prepare("SELECT * FROM guild LIMIT 1").get() as Row | undefined;
  if (!guildRow) throw new Error("SQLite database has no guild row — delete the db file to re-seed.");
  const store: EntityStore = {
    guild: guildSchema.parse(rowToGuild(guildRow)),
    roster: parseAll("characters", characterSchema, (db.prepare("SELECT * FROM characters ORDER BY name").all() as Row[]).map(rowToCharacter)),
    items: parseAll("items", itemSchema, (db.prepare("SELECT * FROM items").all() as Row[]).map(rowToItem)),
    gearSets: parseAll("gear_sets", gearSetSchema, (db.prepare("SELECT * FROM gear_sets").all() as Row[]).map(rowToGearSet)),
    currentGearOverrides: parseAll(
      "current_gear_overrides",
      currentGearOverrideSchema,
      (db.prepare("SELECT * FROM current_gear_overrides").all() as Row[]).map(rowToCurrentGearOverride),
    ),
    raidSessions: parseAll("raid_sessions", raidSessionSchema, (db.prepare("SELECT * FROM raid_sessions").all() as Row[]).map(rowToRaidSession)),
    lootAwards: parseAll("loot_awards", lootAwardSchema, (db.prepare("SELECT * FROM loot_awards").all() as Row[]).map(rowToLootAward)),
    wclReports: parseAll("wcl_reports", wclReportSchema, (db.prepare("SELECT * FROM wcl_reports").all() as Row[]).map(rowToWclReport)),
    wclPlayerFights: parseAll("wcl_player_fights", wclPlayerFightSchema, (db.prepare("SELECT * FROM wcl_player_fights").all() as Row[]).map(rowToWclPlayerFight)),
    wclPlayerOffPull: parseAll("wcl_player_offpull", wclPlayerOffPullSchema, (db.prepare("SELECT * FROM wcl_player_offpull").all() as Row[]).map(rowToWclPlayerOffPull)),
    attendanceExemptions: parseAll("attendance_exemptions", attendanceExemptionSchema, (db.prepare("SELECT * FROM attendance_exemptions").all() as Row[]).map(rowToAttendanceExemption)),
    characterComments: parseAll("character_comments", characterCommentSchema, (db.prepare("SELECT * FROM character_comments ORDER BY created_at DESC").all() as Row[]).map(rowToCharacterComment)),
    itemComments: parseAll("item_comments", itemCommentSchema, (db.prepare("SELECT * FROM item_comments ORDER BY created_at DESC").all() as Row[]).map(rowToItemComment)),
    bossComments: parseAll("boss_comments", bossCommentSchema, (db.prepare("SELECT * FROM boss_comments ORDER BY created_at DESC").all() as Row[]).map(rowToBossComment)),
    bossDrops: parseAll("boss_drops", bossDropSchema, (db.prepare("SELECT * FROM boss_drops").all() as Row[]).map(rowToBossDrop)),
    guildBossDrops: parseAll("guild_boss_drops", guildBossDropSchema, (db.prepare("SELECT * FROM guild_boss_drops").all() as Row[]).map(rowToGuildBossDrop)),
    feedback: parseAll("feedback", feedbackReportSchema, (db.prepare("SELECT * FROM feedback ORDER BY created_at DESC").all() as Row[]).map(rowToFeedback)),
    memberships: parseAll("memberships", membershipSchema, (db.prepare("SELECT * FROM memberships").all() as Row[]).map(rowToMembership)),
    guildRoles: parseAll("guild_roles", guildRoleSchema, (db.prepare("SELECT * FROM guild_roles ORDER BY sort, name").all() as Row[]).map(rowToGuildRole)),
    guildInvites: parseAll("guild_invites", guildInviteSchema, (db.prepare("SELECT * FROM guild_invites ORDER BY created_at DESC").all() as Row[]).map(rowToGuildInvite)),
    guildAudit: parseAll("guild_audit", guildAuditEntrySchema, (db.prepare("SELECT * FROM guild_audit ORDER BY at DESC").all() as Row[]).map(rowToGuildAudit)),
    // accounts / auth_sessions are NOT here on purpose — see EntityStore.
  };
  validateStore(store, "sqlite database");
  return store;
}

function seedIfEmpty(db: DatabaseSync): void {
  const hasGuild = db.prepare("SELECT 1 FROM guild LIMIT 1").get();
  if (hasGuild) return;
  const seed = loadSeedStore();
  try {
    withTx(db, () => {
      insertGuild(db, seed.guild);
      for (const c of seed.roster) insertCharacter(db, c);
      for (const i of seed.items) insertItem(db, i);
      for (const s of seed.gearSets) insertGearSet(db, s);
      for (const o of seed.currentGearOverrides) insertCurrentGearOverride(db, o);
      for (const s of seed.raidSessions) insertRaidSession(db, s);
      for (const a of seed.lootAwards) insertLootAward(db, a);
      for (const r of seed.wclReports) insertWclReport(db, r);
      for (const f of seed.wclPlayerFights) insertWclPlayerFight(db, f);
      for (const o of seed.wclPlayerOffPull) insertWclPlayerOffPull(db, o);
      for (const e of seed.attendanceExemptions) insertAttendanceExemption(db, e);
      for (const c of seed.characterComments) insertCharacterComment(db, c);
      bumpDataVersion(db);
    });
  } catch (e) {
    // Parallel build workers can race the first boot; losing the race is fine.
    const seededByOther = db.prepare("SELECT 1 FROM guild LIMIT 1").get();
    if (!seededByOther) throw e;
  }
}
