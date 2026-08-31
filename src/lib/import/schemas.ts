import { z } from "zod";
import {
  CHARACTER_STATUSES,
  FACTIONS,
  GEAR_OVERRIDE_SOURCES,
  GEAR_SET_KINDS,
  GEAR_SET_SOURCES,
  GEAR_SPECS,
  PHASE_IDS,
  QUALITIES,
  ROLES,
  SESSION_SOURCES,
  SLOT_IDS,
  WOW_CLASSES,
} from "@/lib/constants/wow";
import { COMMENT_CATEGORIES, ITEM_COMMENT_VOICES } from "@/lib/comments";

/**
 * Canonical entity shapes — the single shape contract of the app.
 * Seed JSON is validated against these at load, and every import parser
 * (SixtyUpgrades, Gargul, Warcraft Logs) emits exactly these shapes. That
 * guarantees seed data and real imported data are interchangeable.
 */

export const phaseSchema = z
  .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
  .refine((p) => (PHASE_IDS as readonly number[]).includes(p));

/**
 * What the guild shows the world. Guild settings, deliberately **not**
 * `GuildPolicy`: policy is consumed by pure functions in `src/lib/analysis`,
 * and visibility there would drag authorization into the one layer whose value
 * is having no idea who is asking. See docs/guild-and-player-profiles.md §6.
 *
 * **The order matters.** `VISIBILITY_LADDER` in `src/lib/analysis/public-profile.ts`
 * is this array, and the picker reads it as least-published first.
 */
export const GUILD_VISIBILITIES = ["private", "recruiting", "open"] as const;

export const guildSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  realm: z.string().min(1),
  faction: z.enum(FACTIONS),
  activePhase: phaseSchema,
  /** Defaults closed, so a database that predates this publishes nothing. */
  visibility: z.enum(GUILD_VISIBILITIES).default("private"),
  /**
   * How long every owner may be quiet before the guild can appoint its own.
   *
   * Stored raw and clamped on read by `clampWindows`, not clamped on write: the
   * bounds are a rule about what the app will act on, and a hand-edited row
   * should be brought into range rather than trusted or rejected. Absent means
   * the defaults, which is what every guild has until it says otherwise.
   */
  successionAdminDays: z.number().int().positive().optional(),
  successionMemberDays: z.number().int().positive().optional(),
});

export const characterSchema = z.object({
  id: z.string().min(1),
  guildId: z.string().min(1),
  /** Unique within guild; lowercased it doubles as the URL slug. */
  name: z.string().min(1),
  class: z.enum(WOW_CLASSES),
  spec: z.string().min(1),
  role: z.enum(ROLES),
  /**
   * A second spec they actually raid in — the shadow priest who heals
   * progression, the fury warrior who tanks Hydross. Their logs show both, so
   * without recording it the app reads every off-spec night as a roster error.
   * Optional: most raiders only ever play one.
   */
  offSpec: z.string().min(1).optional(),
  /** What that second spec does in the raid; only meaningful with `offSpec`. */
  offSpecRole: z.enum(ROLES).optional(),
  race: z.string().optional(),
  status: z.enum(CHARACTER_STATUSES),
  /**
   * For an alt: the id of the character it belongs to (its main). Null for
   * mains and unlinked alts. Stored regardless of status so toggling alt↔main
   * doesn't lose the link, but only meaningful while status is "alt".
   */
  mainCharacterId: z.string().nullable().default(null),
  note: z.string().optional(),
  /**
   * The membership that has claimed this character. Null is the normal state —
   * most characters are never claimed.
   *
   * **Not part of the officer's edit form**, and deliberately so: claiming is
   * `members.manage`, editing a character is `roster.edit`, and they are
   * different rights. `updateCharacter` carries the stored value across rather
   * than reading it off the draft — see the comment there, because
   * `insertCharacter` is INSERT OR REPLACE and would otherwise wipe it on every
   * spec change.
   */
  membershipId: z.string().nullable().default(null),
});

/**
 * Item cache entry (WoW item ID is the primary key).
 *
 * Everything but the id is optional: the cache is filled from whatever each
 * source happens to know — a Gargul link carries a name and quality, a log's
 * gear snapshot carries only an icon — and later imports fill the gaps in
 * place. Partial knowledge beats a fabricated "Item #30048".
 */
export const itemSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).optional(),
  quality: z.enum(QUALITIES).optional(),
  /** Wowhead/zamimg icon name, e.g. "inv_axe_60" (no extension). */
  icon: z.string().min(1).optional(),
  slot: z.enum(SLOT_IDS).nullish(),
  source: z.object({ zone: z.string(), boss: z.string().optional() }).optional(),
  phase: phaseSchema.optional(),
  /**
   * True once Wowhead itself answered for this id. Everything else — the
   * curated seed, a name typed into a wishlist, an icon lifted off a log — is
   * a good guess that nothing has checked, and stays re-checkable forever.
   * Absent means unverified; only `resolveItemsFromWowhead` may set it.
   */
  verified: z.boolean().optional(),
  /**
   * Wowhead's "Armor Tokens" subclass: the raid drop an officer hands a vendor
   * for a tier piece. Absent means nobody has asked yet; `false` means Wowhead
   * answered and this is an ordinary item — the two are not the same, and the
   * backfill queue is built on the difference.
   */
  armorToken: z.boolean().optional(),
  /**
   * For a tier piece: the armor token that buys it.
   *
   * Stored on the piece, not the token, because that is the direction the
   * domain is one-to-one. One token buys nine pieces — three classes and, for
   * most, three spec variants each — so token→piece needs a judgement about
   * which variant a raider meant. Piece→token needs none, and "which of the
   * pieces this token buys did they wishlist" answers the judgement from the
   * raider's own list.
   */
  redeemsFrom: z.number().int().positive().optional(),
  /**
   * Wowhead has been asked about this id since the phase became something we
   * read off its answer.
   *
   * Not the same as having a phase: most of TBC's launch items carry no phase
   * tag at all, so without this the backfill would ask about them again on
   * every press, forever. Written by the resolver only; never seeded.
   */
  phaseChecked: z.boolean().optional(),
});

export const slotItemSchema = z.object({
  slot: z.enum(SLOT_IDS),
  itemId: z.number().int().positive(),
  /** Denormalized so a set renders even on item-cache misses. */
  itemName: z.string().min(1),
  /**
   * The permanent enchant the set calls for. `id` is the SpellItemEnchantment
   * id — the SAME id Warcraft Logs reports as permanentEnchant, which is what
   * lets an imported set both name and grade what a raider is actually wearing.
   * `itemId` is the glyph/inscription/armor kit that applies it, when one does.
   */
  enchant: z
    .object({
      id: z.number().int().optional(),
      itemId: z.number().int().optional(),
      name: z.string().min(1),
    })
    .optional(),
  gems: z
    .array(
      z.object({
        id: z.number().int().optional(),
        name: z.string().min(1),
        icon: z.string().optional(),
      }),
    )
    .optional(),
});

/**
 * Open stat map — resilient to whatever keys SixtyUpgrades exports.
 * Display order/labels come from STAT_META; unknown keys are shown prettified.
 */
export const statBlockSchema = z.record(z.string(), z.number());

export const gearSetSchema = z
  .object({
    id: z.string().min(1),
    characterId: z.string().min(1),
    kind: z.enum(GEAR_SET_KINDS),
    phase: phaseSchema.optional(),
    name: z.string().min(1),
    source: z.enum(GEAR_SET_SOURCES),
    sourceUrl: z.url().optional(),
    importedAt: z.string().min(1),
    stats: statBlockSchema,
    slots: z.array(slotItemSchema),
  })
  .refine((s) => s.kind !== "wishlist" || s.phase !== undefined, {
    message: "wishlist gear sets require a phase",
  });

/**
 * One slot of a character's current gear, pinned by an officer.
 *
 * A SixtyUpgrades export is a snapshot of intent, and it goes stale the moment
 * someone wins an upgrade — but the logs know exactly what was worn on every
 * pull. An override pins one slot to an item read off those recent raids, so
 * "currently" on a wishlist row, wishlist completion and item contention all
 * follow reality without waiting for the raider to re-export.
 *
 * One per character × spec × slot (the slot lives on `item`); clearing it
 * hands the slot back to the imported set. Enchant and gems are deliberately
 * not stored: the item is what loot decisions turn on, and the logs already
 * render the worn enchant and gems on the gear panel — inventing names here
 * would be worse than pointing at the pull that has them.
 */
export const currentGearOverrideSchema = z.object({
  characterId: z.string().min(1),
  item: slotItemSchema,
  source: z.enum(GEAR_OVERRIDE_SOURCES),
  /**
   * Which kit the slot belongs to. Absent means "main", so every override
   * written before off-spec gear existed keeps its meaning.
   */
  spec: z.enum(GEAR_SPECS).default("main"),
  /** ISO timestamp the officer pinned it. */
  setAt: z.string().min(1),
});

export const raidSessionSchema = z.object({
  id: z.string().min(1),
  guildId: z.string().min(1),
  /** ISO date of the raid night. */
  date: z.string().min(1),
  zones: z.array(z.string().min(1)).min(1),
  note: z.string().optional(),
  source: z.enum(SESSION_SOURCES),
});

/**
 * The arithmetic a loot decision was made on, frozen at the moment it was made.
 *
 * The council chose snapshot-at-decision over effective-dated policy: live
 * views always read current policy, and only a decision that WAS made gets
 * frozen. That's what makes "why was he ranked first in June" answerable after
 * the weights have moved on.
 *
 * **Absent means the award didn't come from the ranking** — a Gargul import, a
 * hand-added drop, an off-roster destination. It never means "scored zero".
 */
export const awardDecisionSchema = z.object({
  /** The winner's loot-priority score at award time. Absent = no data to score. */
  score: z.number().optional(),
  /** Where they sat on the board, and how many were contending. */
  rank: z.number().int().positive().optional(),
  contenders: z.number().int().nonnegative(),
  /** Each factor as it read: enough to reconstruct the sentence, not the model. */
  factors: z
    .array(
      z.object({
        label: z.string(),
        score: z.number().optional(),
        weight: z.number(),
        detail: z.string(),
      }),
    )
    .default([]),
  adjustments: z
    .array(z.object({ label: z.string(), multiplier: z.number(), note: z.string().optional() }))
    .default([]),
  /** The council's chain for this item, as written at the time. */
  chain: z.string().optional(),
  /** The tier the winner satisfied, when the chain named one. */
  tierLabel: z.string().optional(),
  /** The weighting in force — the numbers behind the score. */
  weights: z.object({
    attendance: z.number(),
    lootDebt: z.number(),
    performance: z.number(),
    preparation: z.number(),
  }),
  capturedAt: z.string().min(1),
});

export const lootAwardSchema = z.object({
  id: z.string().min(1),
  raidSessionId: z.string().min(1),
  /** null = winner not resolved to a roster character (e.g. disenchanted, pug). */
  characterId: z.string().nullable(),
  /**
   * True when the winner deliberately isn't a roster character (disenchanted,
   * banked, PUG). characterId null + external false = awaiting resolution.
   */
  external: z.boolean().default(false),
  /** Always keep exactly what Gargul said. */
  rawWinnerName: z.string().min(1),
  itemId: z.number().int().positive(),
  itemName: z.string().min(1),
  awardedAt: z.string().min(1),
  offspec: z.boolean(),
  note: z.string().optional(),
  /** How the council's board read when this was awarded. See the schema above. */
  decision: awardDecisionSchema.optional(),
});

/* Warcraft Logs performance entities (M4) */

export const wclRoleSchema = z.enum(["tank", "healer", "dps"]);

/** One worn item from a combatant-info gear array (slim, JSON-persisted). */
const wclGearItemSchema = z.object({
  /** Equipment-slot index in WCL's gear-array order. */
  slot: z.number().int().nonnegative(),
  id: z.number().int().positive(),
  ilvl: z.number().int().optional(),
  /** Item quality straight from the log — colours the row with no lookup. */
  quality: z.enum(QUALITIES).optional(),
  /** Permanent enchantment id. Wowhead has no page for these; the item's hover tooltip renders it. */
  enchant: z.number().int().optional(),
  /** Temporary enchant id (oil / stone / poison / imbue). */
  temp: z.number().int().optional(),
  /**
   * Socketed gems, each with the icon the log carries (names come from the
   * item cache). Socket counts aren't logged, so empty sockets stay invisible.
   * Imports from before gem icons were kept are bare ids — read as {id}.
   */
  gems: z
    .array(
      z
        .union([z.number().int(), z.object({ id: z.number().int(), icon: z.string().optional() })])
        .transform((gem) => (typeof gem === "number" ? { id: gem } : gem)),
    )
    .default([]),
  /** Pass-throughs when WCL includes them. */
  name: z.string().optional(),
  icon: z.string().optional(),
});

/** One fetched Warcraft Logs report (refetching replaces it wholesale). */
export const wclReportSchema = z.object({
  /** The WCL report code — primary key, straight from the URL. */
  code: z.string().min(1),
  title: z.string().min(1),
  zone: z.string().optional(),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  fetchedAt: z.string().min(1),
  /**
   * The aura names this app asked WCL for when the report was fetched. Absence
   * of an aura from a report's rows only means "the raid didn't have it" if the
   * aura is in here; otherwise it means the report predates that track.
   * Empty on reports imported before this was recorded.
   */
  upkeepTracks: z.array(z.string()).default([]),
  /**
   * What each enemy caster tried on each boss pull — the denominator behind
   * the interrupt counts.
   *
   * Only abilities with a cast bar, aggregated per (pull, caster, ability).
   * Defaults empty, which is how every report imported before it existed reads;
   * the board says "not recorded" rather than claiming the boss cast nothing.
   * A re-import fills it in.
   */
  enemyCasts: z
    .array(
      z.object({
        fightId: z.number().int(),
        /** The enemy, as the log named it. Several adds of one name merge. */
        caster: z.string().min(1),
        ability: z.string().min(1),
        abilityId: z.number().int().optional(),
        /** Cast bars started. Always at least 1 — instants are not stored. */
        started: z.number().int().positive(),
        /** Cast bars that finished. */
        landed: z.number().int().nonnegative(),
      }),
    )
    .default([]),
  /**
   * Auras present at this report's boss pulls that the consumable tables
   * couldn't place, most frequent first.
   *
   * Empty means "none recorded", which on a report imported before this was kept
   * is NOT the same as "nothing was unknown" — the dump existed at import time
   * and was thrown away. Curating one of these is what makes a report worth
   * re-importing, so keeping the list is what lets the app say which.
   */
  unclassifiedAuras: z
    .array(
      z.object({
        name: z.string().min(1),
        abilityId: z.number().int().optional(),
        count: z.number().int().nonnegative(),
      }),
    )
    .default([]),
  /** Optional link to the Gargul raid session covering the same night. */
  raidSessionId: z.string().nullable().default(null),
});

/** One player × one boss pull, as extracted from a report. */
export const wclPlayerFightSchema = z.object({
  id: z.string().min(1),
  reportCode: z.string().min(1),
  fightId: z.number().int().nonnegative(),
  encounterId: z.number().int().nonnegative(),
  encounterName: z.string().min(1),
  kill: z.boolean(),
  /** Boss health % remaining — only meaningful on wipes. */
  fightPercentage: z.number().optional(),
  durationMs: z.number().nonnegative(),
  /** Fight start, ms from report start — absolute pull/kill clock times derive from it. Absent on pre-timeline imports. */
  fightStartMs: z.number().nonnegative().optional(),
  /** Player name exactly as logged (no realm — WCL keeps server separate). */
  actorName: z.string().min(1),
  /** Roster match by name, like Gargul winners; null = not on the roster. */
  characterId: z.string().nullable().default(null),
  /** WCL's class/spec strings — display-only, never forced into our enums. */
  className: z.string().optional(),
  spec: z.string().optional(),
  role: wclRoleSchema,
  /** Parse percentile (dps for tanks/dps, hps for healers). */
  parsePercent: z.number().min(0).max(100).optional(),
  /** Percentile within the item-level bracket — gear-adjusted skill signal. */
  bracketPercent: z.number().min(0).max(100).optional(),
  /**
   * Parse percentile on damage to the BOSS only — the metric that ignores adds
   * and cleave padding. Absent on imports from before it was fetched.
   */
  bossParsePercent: z.number().min(0).max(100).optional(),
  /** Boss-only dps behind `bossParsePercent`. */
  bossAmount: z.number().optional(),
  /** The metric value itself (dps or hps). */
  amount: z.number().optional(),
  deaths: z.number().int().nonnegative().default(0),
  flask: z.string().optional(),
  elixirs: z.array(z.string()).default([]),
  /** Scroll buffs at pull, rank included ("Scroll of Agility V"). */
  scrolls: z.array(z.string()).default([]),
  food: z.boolean().default(false),
  /** Temporary weapon enchant at pull (oil / stone / poison / imbue). */
  weaponBuff: z.boolean().default(false),
  /** A combat-potion aura was already up at pull (pre-pot). */
  prepot: z.boolean().default(false),
  /**
   * Which potion that was. Absent on reports imported before the name was
   * kept — the boolean above was all we stored, so those count the use under a
   * stand-in name until they are re-imported.
   */
  prepotLabel: z.string().optional(),
  potions: z.array(z.string()).default([]),
  /** Non-potion in-fight consumables (healthstones, runes, mana gems, seeds, drums). */
  otherCasts: z.array(z.string()).default([]),
  /** Off-slot consumable buffs at pull (alcohol, Bogling Root, …). */
  extras: z.array(z.string()).default([]),
  /** Major class cooldowns cast during the pull, one entry per use. */
  cooldowns: z.array(z.string()).default([]),
  /**
   * When those cooldowns — and the shaman totem drops — happened, ms from the
   * pull start. Empty on imports from before cast timing was tracked.
   */
  castTimes: z
    .array(
      z.object({
        name: z.string().min(1),
        atMs: z.number().nonnegative(),
        /** Friendly target, when it wasn't the caster themself. */
        target: z.string().optional(),
        /** A shaman totem drop rather than a class cooldown. */
        totem: z.boolean().optional(),
        /**
         * Something put on the ground — land mine, snake trap, turret, thornling.
         *
         * Absent on every report imported before those were tracked, which the
         * page reports as "not recorded" rather than "nobody laid one". Four of
         * the five are also consumables and are counted as such in `otherCasts`;
         * this flag exists so the pull-by-pull view can ask its own question
         * without moving either the gold or the cooldown figures.
         */
        deployable: z.boolean().optional(),
      }),
    )
    .default([]),
  /**
   * Dispels this raider landed during the pull — a cleanse or decurse off a
   * teammate, or a buff stripped off an enemy.
   *
   * Filed against the raider who *cast* it, with the recipient in `target`, so
   * "who was decursing on Archimonde" is one column and the receiving end is a
   * derivation. Empty on every report imported before dispels were fetched at
   * all, which is a different statement from a night with none — see
   * `wcl/dispels.ts`, and re-import to fill it in.
   */
  dispels: z
    .array(
      z.object({
        atMs: z.number().nonnegative(),
        /**
         * WCL spell id of the dispel. Stored beside the name because it is the
         * match key: Warcraft Logs resolves some TBC ids against a *modern*
         * spell database, so the same press is spelled two ways across game
         * versions, and `dispelAbilityOf` classifies on the id at read time.
         */
        spellId: z.number().int().optional(),
        /** The dispel as the log named it. */
        spell: z.string().min(1),
        /** Who it landed on — a raider, a pet, or an enemy for a strip. */
        target: z.string().min(1),
        /** The aura that came off, as the log named it. */
        removed: z.string().min(1),
        removedId: z.number().int().optional(),
        /** It was a BUFF on an enemy (Purge, Spellsteal, Tranquilizing Shot). */
        offensive: z.boolean().optional(),
      }),
    )
    .default([]),
  /**
   * Casts this raider cut off during the pull — a kick, a pummel, a shock, a
   * counterspell.
   *
   * Filed against the raider who *pressed* it, with the mob in `target` and the
   * cast that died in `stopped`, because "who was on kick duty in Essence of
   * Desire" is the question and the victim side is a derivation. Empty on every
   * report imported before interrupts were fetched at all, which is a different
   * statement from a night nobody interrupted on — see `wcl/interrupts.ts`, and
   * re-import to fill it in.
   */
  interrupts: z
    .array(
      z.object({
        atMs: z.number().nonnegative(),
        /**
         * WCL spell id of the interrupt. Stored beside the name because it is
         * the match key: Earth Shock arrived under two ids in a single night,
         * and `interruptAbilityOf` classifies on the id at read time.
         */
        spellId: z.number().int().optional(),
        /** The interrupt as the log named it. */
        spell: z.string().min(1),
        /** The enemy it was pressed on. */
        target: z.string().min(1),
        /** The cast that was stopped, as the log named it. */
        stopped: z.string().min(1),
        stoppedId: z.number().int().optional(),
        /**
         * The phase it landed in, as Warcraft Logs names it — "P2: Essence of
         * Desire". Absent on an unphased encounter, and on any report fetched
         * before phases were asked for.
         */
        phase: z.string().min(1).optional(),
      }),
    )
    .default([]),
  /**
   * Each death, ms from the pull start, in order — and what landed it.
   *
   * The count alone says a raid loses people; the timing says whether they lose
   * them to an opener nobody survived or to attrition at 40%, and those are
   * different problems with different fixes. Empty on reports imported before
   * the timing was kept — the events were always fetched, the timestamp was
   * simply dropped — so a re-import is what fills them in.
   *
   * `killer` and `ability` were dropped the same way and for longer: Warcraft
   * Logs puts `killerID` and a fully named `killingAbility` on every death event
   * it serves, and the schema simply never read them. **A bare number is how a
   * row imported before that looks**, so it parses to a record with the time and
   * nothing else — which is exactly what such a row knows. Re-import to fill in
   * the rest.
   */
  deathTimes: z
    .array(
      z.union([
        z.number().nonnegative().transform((atMs) => ({ atMs })),
        z.object({
          atMs: z.number().nonnegative(),
          /** Who landed the killing blow — a boss, an add, or nothing named. */
          killer: z.string().min(1).optional(),
          /** The killing ability as the log names it ("Melee" for a swing). */
          ability: z.string().min(1).optional(),
          /**
           * What they took in the ~10s before it, newest first.
           *
           * The killing blow alone says "Melee", which for a raider at 3% health
           * is the least interesting fact about their death. The run-up is what
           * says whether they were being ground down, stood in something, or got
           * hit by one enormous thing.
           *
           * Absent on reports imported before it was fetched, and on deaths
           * where the log named no ability for a single hit — a shorter recap
           * beats one padded with "Unknown Ability".
           */
          recap: z
            .array(
              z.object({
                atMs: z.number().nonnegative(),
                ability: z.string().min(1),
                source: z.string().min(1).optional(),
                /** Damage that landed, after mitigation. */
                amount: z.number().nonnegative(),
                /** What a shield ate, when any did. */
                absorbed: z.number().nonnegative().optional(),
              }),
            )
            .optional(),
        }),
      ]),
    )
    .default([]),
  /**
   * Maintained debuff/buff uptimes (warlock curses, Thunder Clap, shouts…),
   * % of the pull for the best target. `targets` (absent on pre-timeline
   * imports) breaks it down per victim — boss, adds (with instance numbers)
   * or the buffed friendly — with the exact up-intervals inside the pull.
   */
  upkeep: z
    .array(
      z.object({
        name: z.string().min(1),
        pct: z.number().min(0).max(100),
        targets: z
          .array(
            z.object({
              /** Target name as logged (NPC or friendly player). */
              target: z.string().min(1),
              /** WCL instance number when several copies of the NPC exist. */
              instance: z.number().int().positive().optional(),
              /** True when the target is the encounter boss (WCL subType "Boss"). */
              boss: z.boolean(),
              /** True when the target is a friendly player — feeds the "uptime by player" view. */
              player: z.boolean().optional(),
              pct: z.number().min(0).max(100),
              /** [startMs, endMs] pairs relative to the fight start. */
              segments: z.array(z.tuple([z.number(), z.number()])),
              /** ≈ times the aura was applied/refreshed (stacking spam like Sunder Armor counts each landed cast). */
              applications: z.number().int().nonnegative().optional(),
              /**
               * Landed casts that raised the stack, and landed casts that only
               * renewed the duration — the two halves of `applications`.
               *
               * They answer different questions about a stacking debuff. Stack-ups
               * are the raid *building* Sunder; refreshes are somebody *holding* it
               * at whatever it reached. A warrior with 20 refreshes and 4 stack-ups
               * did a different job from one with the reverse, and `applications`
               * alone reads them as identical.
               */
              stackUps: z.number().int().nonnegative().optional(),
              refreshes: z.number().int().nonnegative().optional(),
              /**
               * `[msFromPullStart, stack]` each time THIS source moved the stack.
               *
               * Per source, because a cast belongs to whoever made it — the
               * target's actual stack timeline is the merge of every source's
               * points, which is what `mergeDebuffOnTarget` reconstructs. Absent on
               * reports imported before the stack was kept; WCL has always sent it
               * on `applydebuffstack` and it was dropped.
               */
              stackPoints: z.array(z.tuple([z.number(), z.number().int()])).optional(),
            }),
          )
          .optional(),
      }),
    )
    .default([]),
  drums: z.number().int().nonnegative().default(0),
  runes: z.number().int().nonnegative().default(0),
  healthstones: z.number().int().nonnegative().default(0),
  sappers: z.number().int().nonnegative().default(0),
  /** Expected-to-be-enchanted gear slots missing a permanent enchant at pull. */
  missingEnchants: z.array(z.string()).default([]),
  /** Full worn-gear snapshot at the pull (empty for pre-gear-tracking imports). */
  gear: z.array(wclGearItemSchema).default([]),
  /**
   * Points per talent tree at the pull, in the game's tree order — the build as
   * actually played (a Warrior's [33,28,0] and [21,40,0] are different specs
   * wearing the same class name). Empty for imports predating talent capture.
   *
   * Opaque on purpose: compare arrays for equality, never infer which abilities
   * a build could use — see the note in wcl/normalize.
   */
  talents: z.array(z.number()).default([]),
});

/**
 * One player's consumable use away from the boss pulls, for one report.
 *
 * Boss pulls are a minority of a raid night. A potion drunk clearing trash
 * costs the same gold and shows the same habit as one drunk on the boss, and
 * pet food is applied between pulls by definition — neither has a fight row to
 * live on, so they get one record per player per report instead.
 */
export const wclPlayerOffPullSchema = z.object({
  /** `${reportCode}|${lowercased actor name}` — one per player per report. */
  id: z.string().min(1),
  reportCode: z.string().min(1),
  actorName: z.string().min(1),
  /** Roster match, null when the name belongs to nobody tracked. */
  characterId: z.string().nullable(),
  potions: z.array(z.string()).default([]),
  otherCasts: z.array(z.string()).default([]),
  drums: z.number().int().nonnegative().default(0),
  runes: z.number().int().nonnegative().default(0),
  healthstones: z.number().int().nonnegative().default(0),
  sappers: z.number().int().nonnegative().default(0),
  /**
   * Food and scrolls put on their pet, with when it happened.
   *
   * **A bare string is how a row imported before the timing looks**, and it
   * parses to a record carrying the name and nothing else — which is exactly
   * what such a row knows. Same shape as `deathTimes`, for the same reason:
   * re-import is what fills the rest in.
   *
   * The timing matters because the count alone is unreadable at any scope
   * smaller than the night. "Kibler's Bits ×3" against a single pull looks
   * broken; "fed before Hydross, again before Vashj" is the same fact and
   * answers the question an officer actually has.
   */
  petConsumables: z
    .array(
      z.union([
        // Annotated so both branches carry the same shape: without this the
        // union keeps a narrower arm and every reader has to prove `atMs`
        // exists before touching it.
        z
          .string()
          .min(1)
          .transform((name): { name: string; atMs?: number; fightId?: number } => ({ name })),
        z.object({
          name: z.string().min(1),
          /** Ms from the report start — orders applications across the night. */
          atMs: z.number().nonnegative().optional(),
          /**
           * The boss pull it landed in. Absent means between pulls, which is
           * where most feeding happens and is not a gap in the data.
           */
          fightId: z.number().int().nonnegative().optional(),
        }),
      ]),
    )
    .default([]),
  /**
   * Scrolls the pet was seen **holding**, earliest sighting first.
   *
   * Separate from `petConsumables` on purpose, and the separation is the whole
   * point: that field counts what somebody was logged doing and is what the
   * gold is built from, while this one only reports that the aura was on the
   * pet. It cannot say how many scrolls were read and must not be counted as
   * though it could — a pet re-entering play republishes its entire aura set at
   * once, so counting sightings would bill a hunter for every summon.
   *
   * Defaults empty, which is also what every report imported before the buff
   * stream carried scroll ids reads as. A re-import is what fills it in.
   */
  petBuffsSeen: z
    .array(
      z.object({
        name: z.string().min(1),
        /** Ms from the report start — the first time it was seen. */
        atMs: z.number().nonnegative(),
      }),
    )
    .default([]),
  /**
   * Dispels landed away from the boss pulls — trash, almost entirely, which is
   * where most of a decurser's night goes.
   *
   * **Counted, not timed.** A raid night is over a hundred trash segments and a
   * timestamp against one of them answers nothing, so these collapse to a count
   * per (zone, spell, target, aura). The zone is the part that matters: a night
   * that clears Hyjal and Black Temple asks two different questions of the
   * raid, and one number for the night answers neither.
   *
   * Defaults empty, which is also how every report imported before dispels were
   * fetched reads. A re-import fills it in.
   */
  trashDispels: z
    .array(
      z.object({
        /** The instance the trash belonged to ("Hyjal Summit", "Black Temple"). */
        zone: z.string().min(1),
        spellId: z.number().int().optional(),
        spell: z.string().min(1),
        target: z.string().min(1),
        removed: z.string().min(1),
        removedId: z.number().int().optional(),
        offensive: z.boolean().optional(),
        /** How many times this exact removal happened. */
        count: z.number().int().positive(),
      }),
    )
    .default([]),
  /**
   * Interrupts landed away from the boss pulls — trash, overwhelmingly, which
   * is where most of this raid’s kicking happens (201 of 239 on the probed
   * MH+BT night, 173 of them in Hyjal).
   *
   * **Counted, not timed**, and per zone, for exactly the reasons `trashDispels`
   * gives above. Defaults empty, which is also how every report imported before
   * interrupts were fetched reads; a re-import fills it in.
   */
  trashInterrupts: z
    .array(
      z.object({
        /** The instance the trash belonged to ("Hyjal Summit", "Black Temple"). */
        zone: z.string().min(1),
        spellId: z.number().int().optional(),
        spell: z.string().min(1),
        target: z.string().min(1),
        stopped: z.string().min(1),
        stoppedId: z.number().int().optional(),
        /** How many times this exact interrupt happened. */
        count: z.number().int().positive(),
      }),
    )
    .default([]),
});


/**
 * One officer comment on a character — a timestamped log entry, richer than the
 * single inline `note`. Free-form body with an optional author and a category
 * for filing/coloring. Multiple per character, newest first when rendered.
 */
export const characterCommentSchema = z.object({
  id: z.string().min(1),
  characterId: z.string().min(1),
  /** What the comment is about — drives the colored chip. Defaults to a neutral note. */
  category: z.enum(COMMENT_CATEGORIES).default("note"),
  body: z.string().min(1),
  /** Who wrote it (free text — there's no auth). Optional. */
  author: z.string().optional(),
  /** ISO timestamp the comment was created. */
  createdAt: z.string().min(1),
});

/**
 * An excused absence: one character × one reset week (the EU-reset Wednesday
 * ISO date) that should not count toward that character's attendance markup.
 */
export const attendanceExemptionSchema = z.object({
  characterId: z.string().min(1),
  /** Reset-week start (Wednesday), as produced by resetWeekStart(). */
  weekStart: z.string().min(1),
  /** Optional reason ("told us in advance", "holiday"). */
  note: z.string().optional(),
});

/* Seed file schemas */
export const seedGuildSchema = guildSchema;
export const seedRosterSchema = z.array(characterSchema);
export const seedItemsSchema = z.array(itemSchema);
export const seedGearSetsSchema = z.array(gearSetSchema);
export const seedRaidSessionsSchema = z.array(raidSessionSchema);
export const seedLootAwardsSchema = z.array(lootAwardSchema);
export const seedWclReportsSchema = z.array(wclReportSchema);
export const seedWclPlayerFightsSchema = z.array(wclPlayerFightSchema);
export const seedAttendanceExemptionsSchema = z.array(attendanceExemptionSchema);
/**
 * A note on one item — from a raider about their own claim, or from an officer
 * about the council's.
 *
 * `characterId` is optional and means two different things on purpose: set, the
 * note is about that raider's claim ("2nd choice for Melige, he'd rather hold");
 * absent, it is about the item itself ("contested every week, flag it high
 * value"). Both belong on the same page, so they share a table.
 *
 * Nothing here feeds a score. That is the point — the council said the
 * BiS-versus-second-choice call is too situational to automate, so this carries
 * the situation instead.
 */
export const itemCommentSchema = z.object({
  id: z.string().min(1),
  itemId: z.number().int().positive(),
  /** Whose claim the note is about, when it is about one. */
  characterId: z.string().min(1).optional(),
  voice: z.enum(ITEM_COMMENT_VOICES).default("officer"),
  body: z.string().min(1),
  /** Who wrote it (free text — there's no auth). Optional. */
  author: z.string().optional(),
  createdAt: z.string().min(1),
});

/**
 * One drop on the foundational table: this boss, in this zone, drops this item.
 *
 * A fact about the game rather than a guild's judgement, which is why it has no
 * guild and no priority. `itemId` is optional because a drop table is written
 * in names and the id arrives later from the resolver.
 */
export const bossDropSchema = z.object({
  zone: z.string().min(1),
  bossKey: z.string().min(1),
  boss: z.string().min(1),
  /** Normalized item name — the key, matching the priority sheet's rule. */
  itemKey: z.string().min(1),
  itemName: z.string().min(1),
  itemId: z.number().int().positive().optional(),
  /** The drop table's finer wording: "Plate - Waist". */
  slotLabel: z.string().optional(),
  note: z.string().optional(),
  author: z.string().optional(),
  updatedAt: z.string().min(1),
});

/** One guild's addition to, or removal from, a foundational drop. */
export const guildBossDropSchema = bossDropSchema.extend({
  guildId: z.string().min(1),
  action: z.enum(["add", "hide"]),
});

/**
 * A council note on one boss, read under him on the loot plan.
 *
 * `bossKey` is the identity and `boss` is the label — see the table comment in
 * db.ts for why both are stored. `zone` is part of the key because trash is a
 * drop source in every raid.
 */
export const bossCommentSchema = z.object({
  id: z.string().min(1),
  zone: z.string().min(1),
  bossKey: z.string().min(1),
  boss: z.string().min(1),
  body: z.string().min(1),
  /** Who wrote it (free text — there's no auth). Optional. */
  author: z.string().optional(),
  createdAt: z.string().min(1),
});

export const seedCharacterCommentsSchema = z.array(characterCommentSchema);

/**
 * What the reporter's browser volunteered about where they were when something
 * looked wrong. Every field is optional and every field is shown to them before
 * they send it — see `FeedbackDialog`. Nothing here is collected passively.
 */
export const feedbackContextSchema = z.object({
  /** A readable name for the element they pointed at: `button "Award item"`. */
  elementLabel: z.string().max(200).optional(),
  /** CSS path to that element, for finding it again in the source. */
  elementSelector: z.string().max(500).optional(),
  /** Its visible text, trimmed — usually the fastest way to locate it. */
  elementText: z.string().max(300).optional(),
  /** "1512×945". Layout bugs are usually width bugs. */
  viewport: z.string().max(40).optional(),
  /** Which theme was active, since half the UI now depends on it. */
  theme: z.enum(["light", "dark"]).optional(),
  /** Coarse browser/OS string the widget derives — never the raw UA. */
  browser: z.string().max(120).optional(),
});

/**
 * A bug report someone filed from inside the app.
 *
 * Deliberately unlinked to any character or raid: this is about the tool, not
 * about the guild, and it must stay readable even after the page it describes
 * has been rewritten. `route` and `url` are stored as text for that reason.
 */
export const feedbackReportSchema = z.object({
  id: z.string().min(1),
  /**
   * What kind of report this is. Defaults to `bug` so reports filed before
   * the two entry points existed keep the meaning they were filed under.
   */
  kind: z.enum(["bug", "feedback"]).default("bug"),
  /** Free text — there's no auth here, same as character comments. */
  reporter: z.string().max(60).optional(),
  body: z.string().min(1),
  /** Pathname only, e.g. `/characters/stiligwarr/performance`. */
  route: z.string().min(1),
  /** Full URL including query, which often carries the state that broke. */
  url: z.string().min(1),
  /** Absent when the reporter opted out of sharing context. */
  context: feedbackContextSchema.optional(),
  /** Triage state. The reporter's words are never edited, only triaged. */
  status: z.enum(["open", "resolved"]).default("open"),
  /**
   * How much it matters, set by whoever triages it — never by the reporter.
   *
   * `unset` rather than a middle value: "nobody has looked at this yet" and
   * "somebody looked and called it minor" are different states, and a default
   * of "minor" would quietly turn the first into the second.
   */
  priority: z.enum(["unset", "minor", "major"]).default("unset"),
  /**
   * The triager's note back — what was decided, what it's waiting on, why it
   * was closed. Kept apart from `body`, which stays exactly as it was filed.
   */
  adminNote: z.string().max(2000).optional(),
  /**
   * Who left the note and when.
   *
   * Free text and self-declared, like every other name in this app — there is
   * no auth here. It is still what makes a note answerable: "somebody decided
   * this" and "Fredrik decided this on Tuesday" are different messages, and an
   * officer coming back to the page needs to know whether the note is theirs.
   */
  adminNoteAuthor: z.string().max(60).optional(),
  adminNoteAt: z.string().optional(),
  /**
   * Who closed it and when.
   *
   * `status` used to flip in place, so a resolved report recorded the decision
   * and lost the decider — the one thing the note field bothers to keep. Both
   * are cleared when a report is reopened: a signature on a report that is open
   * again claims a call nobody is standing behind.
   *
   * Absent on everything closed before this existed, and no backfill can invent
   * it — nothing recorded who, and nothing can now.
   */
  resolvedBy: z.string().max(60).optional(),
  resolvedAt: z.string().optional(),
  createdAt: z.string().min(1),
});

/* Identity — accounts, sessions, memberships, roles, invites.
 *
 * See docs/guild-and-player-profiles.md. Three shapes worth knowing before
 * reading these: an **account** is a login and is global to the deployment; a
 * **membership** is that account inside one guild and is what the app means by
 * "player"; a **character** is a toon, which a membership may or may not have
 * claimed. Nothing crosses a guild boundary, so a membership carries its own
 * display name rather than reading one off the account. */

/**
 * A login. Discord is the only identity this app stores — a guild already has
 * Discord, so the invite lands in the officer channel and no password is ever
 * held here to leak.
 */
export const accountSchema = z.object({
  id: z.string().min(1),
  /** Discord's snowflake. The account's real primary key as far as identity goes. */
  discordId: z.string().min(1),
  /** For display only, and refreshed on each login — Discord names change. */
  discordUsername: z.string().max(80).optional(),
  avatarUrl: z.string().max(300).optional(),
  /**
   * Runs the service. **Orthogonal to guild membership, not exclusive of it** —
   * the person operating a deployment is normally also somebody's guild master,
   * and this deployment's owner is exactly that.
   *
   * What keeps an operator out of a guild is not the schema: it is that
   * `decide()` reads guild capabilities off a membership and never off this
   * flag. An earlier design enforced exclusivity with a database trigger; the
   * trigger was removed along with the two-account model it belonged to,
   * because the separation it protected was already guaranteed one layer up.
   * See docs/guild-and-player-profiles.md §7.
   */
  appAdmin: z.boolean().default(false),
  disabled: z.boolean().default(false),
  createdAt: z.string().min(1),
  lastSeenAt: z.string().optional(),
});

/**
 * A logged-in browser.
 *
 * Called `AuthSession` rather than `Session` on purpose: `raid_sessions` are a
 * raid night, and this codebase talks about those constantly. Two things named
 * "session" in one app is a bug waiting for a tired reader.
 *
 * The row's id **is** the SHA-256 of the cookie value, never the value itself.
 * A stolen database therefore yields no usable cookies.
 */
export const authSessionSchema = z.object({
  /** SHA-256 of the cookie value. */
  id: z.string().min(1),
  accountId: z.string().min(1),
  createdAt: z.string().min(1),
  expiresAt: z.string().min(1),
  /** Set when signed out or revoked; a revoked row is kept so it can't be reused. */
  revokedAt: z.string().optional(),
  userAgent: z.string().max(300).optional(),
});

/**
 * A guild-defined role.
 *
 * `capabilities` is a JSON list on the row rather than a join table: a role
 * owns its grants, the update flow is replace-all, and there is no query that
 * wants them separately. Same shape as a gear set owning its slots.
 *
 * `colour` names a **role**, not a hex — `class-warrior`, `accent`. Invariant 7:
 * only globals.css knows what a colour looks like in each theme.
 */
export const guildRoleSchema = z.object({
  id: z.string().min(1),
  guildId: z.string().min(1),
  name: z.string().min(1).max(40),
  colour: z.string().max(40).optional(),
  sort: z.number().int().default(0),
  /** Unknown strings are dropped on read — see sanitizeCapabilities. */
  capabilities: z.array(z.string()).default([]),
  /**
   * The implicit baseline every membership carries. Exactly one per guild, and
   * it cannot be deleted: it is what makes "what can a plain raider see" one
   * editable row instead of a role somebody has to remember to assign.
   */
  baseline: z.boolean().default(false),
});

/** An account inside one guild. The app's "player". */
export const membershipSchema = z.object({
  id: z.string().min(1),
  guildId: z.string().min(1),
  accountId: z.string().min(1),
  /** What this person is called *in this guild*. Nothing crosses a boundary. */
  displayName: z.string().min(1).max(60),
  /** Ownership, not a role. Exactly one per guild; holds every capability. */
  isGuildMaster: z.boolean().default(false),
  roleIds: z.array(z.string()).default([]),
  joinedAt: z.string().min(1),
});

/**
 * An officer's invitation, issued **for a character already on the roster**.
 *
 * Redeeming it creates the membership and claims that character in one act,
 * which is what makes "prove you are who you say" an officer's judgement rather
 * than an identity-verification problem this project would have to solve.
 *
 * The code handed out is never stored — only its hash, exactly like a session.
 */
export const guildInviteSchema = z.object({
  id: z.string().min(1),
  guildId: z.string().min(1),
  characterId: z.string().min(1),
  /** SHA-256 of the code an officer hands over. */
  codeHash: z.string().min(1),
  /** Roles the redeemer lands with. Empty means the baseline alone. */
  roleIds: z.array(z.string()).default([]),
  /** Membership id of the issuing officer, or "system" for the bootstrap invite. */
  createdBy: z.string().min(1),
  createdAt: z.string().min(1),
  expiresAt: z.string().min(1),
  redeemedAt: z.string().optional(),
  /** Membership id created by the redemption. */
  redeemedBy: z.string().optional(),
});

/**
 * Something the guild is entitled to know happened to it.
 *
 * Break-glass is the reason this exists: an override the guild cannot see is a
 * back door, so the audit write is part of the grant rather than a nicety. It
 * lives in the guild's own data, readable by its officers — not in a
 * service-side log only the admin can reach.
 */
export const guildAuditEntrySchema = z.object({
  id: z.string().min(1),
  guildId: z.string().min(1),
  /** e.g. `break-glass.open`. Read by officers, so keep it legible. */
  kind: z.string().min(1).max(60),
  /** Who, as the guild should read it — a display name, not an opaque id. */
  actor: z.string().min(1).max(120),
  /** Required for break-glass; no reason, no access. */
  reason: z.string().max(500).optional(),
  detail: z.string().max(1000).optional(),
  at: z.string().min(1),
  /** When the access it records expires, for entries that grant something. */
  expiresAt: z.string().optional(),
});

