import { DatabaseSync } from "node:sqlite";
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
import { validateStore, type EntityStore } from "@/lib/data/store";
import { opt, type Row } from "@/lib/data/db/core";
/**
 * A SQLite row back into a domain object, and the whole store in one read.
 *
 * Every load re-validates against the canonical zod schemas, so schema drift
 * surfaces as a loud error rather than as a half-rendered page.
 */

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
    // Null on a database written before the column existed; the schema default
    // turns that into "nothing seen", which a re-import fills in.
    petBuffsSeen: JSON.parse((r.pet_buffs_seen_json as string | null) ?? "[]"),
    trashDispels: JSON.parse((r.trash_dispels_json as string | null) ?? "[]"),
    trashInterrupts: JSON.parse((r.trash_interrupts_json as string | null) ?? "[]"),
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
    race: opt(r.race),
    professions: JSON.parse((r.professions_json as string | null) ?? "[]"),
    status: r.status,
    mainCharacterId: (r.main_character_id as string | null) ?? null, note: opt(r.note),
    membershipId: (r.membership_id as string | null) ?? null,
  };
}

/* Identity row mapping. JSON columns are owned lists, same as gear-set slots. */

export function rowToMembership(r: Row): unknown {
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

export function rowToGuildInvite(r: Row): unknown {
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

export function rowToAccount(r: Row): unknown {
  return {
    id: r.id, discordId: r.discord_id, discordUsername: opt(r.discord_username),
    avatarUrl: opt(r.avatar_url), appAdmin: r.app_admin === 1, disabled: r.disabled === 1,
    createdAt: r.created_at, lastSeenAt: opt(r.last_seen_at),
  };
}

export function rowToAuthSession(r: Row): unknown {
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
    // Null before the column existed, which reads as "no enemy casts recorded"
    // — not "the boss cast nothing". Only a re-import tells the two apart.
    enemyCasts: JSON.parse((r.enemy_casts_json as string | null) ?? "[]"),
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
    lateConsumables: JSON.parse((r.late_consumables_json as string | null) ?? "[]"),
    scrolls: JSON.parse((r.scrolls_json as string | null) ?? "[]"), food: r.food === 1,
    weaponBuff: r.weapon_buff === 1, prepot: r.prepot === 1,
    prepotLabel: opt(r.prepot_label),
    deathTimes: JSON.parse((r.death_times_json as string | null) ?? "[]"),
    potions: JSON.parse(r.potions_json as string),
    otherCasts: JSON.parse((r.other_casts_json as string | null) ?? "[]"),
    extras: JSON.parse((r.extras_json as string | null) ?? "[]"),
    cooldowns: JSON.parse((r.cooldowns_json as string | null) ?? "[]"),
    castTimes: JSON.parse((r.cast_times_json as string | null) ?? "[]"),
    // Null before the column existed, which the schema default reads as "no
    // dispels recorded" — not "nobody dispelled". A re-import is the fix.
    dispels: JSON.parse((r.dispels_json as string | null) ?? "[]"),
    // Same reading as dispels above: null is "no interrupts recorded", which is
    // not "nobody interrupted". Only a re-import tells the two apart.
    interrupts: JSON.parse((r.interrupts_json as string | null) ?? "[]"),
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
