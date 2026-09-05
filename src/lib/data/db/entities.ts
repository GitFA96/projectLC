import { DatabaseSync } from "node:sqlite";
import type {
  AttendanceExemption,
  Character,
  CharacterComment,
  ItemComment,
  BossComment,
  BossDrop,
  GuildBossDrop,
  CurrentGearOverride,
  FeedbackReport,
  GearSet,
  Guild,
  Item,
  LootAward,
  RaidSession,
  WclPlayerFight,
  WclPlayerOffPull,
  WclReport,
} from "@/lib/types";
import { bumpDataVersion } from "@/lib/data/db/core";
/**
 * Writing the rows the read model is built from.
 *
 * Several of these are `INSERT OR REPLACE` and double as the update path, which
 * is the trap change-chains §2 spells out: a column missing from the writer's
 * list is reset to its default on every update, not just on insert, and nothing
 * fails.
 */

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
export function insertGuild(db: DatabaseSync, g: Guild): void {
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
    `INSERT OR REPLACE INTO characters (id, guild_id, name, class, spec, role, off_spec, off_spec_role, race, professions_json, status, main_character_id, note, membership_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    c.id, c.guildId, c.name, c.class, c.spec, c.role, c.offSpec ?? null, c.offSpecRole ?? null,
    c.race ?? null, JSON.stringify(c.professions ?? []), c.status, c.mainCharacterId ?? null,
    c.note ?? null, c.membershipId ?? null,
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

/**
 * Seed an item row verbatim. `verified` is left to its DEFAULT 0 on purpose:
 * the curated seed is a hand-written starting point, not Wowhead's answer, and
 * saying so is what lets the resolver come back and correct it later.
 */
export function insertItem(db: DatabaseSync, i: Item): void {
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
        enemy_casts_json, unclassified_auras_json, raid_session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    r.code,
    r.title,
    r.zone ?? null,
    r.startTime,
    r.endTime,
    r.fetchedAt,
    JSON.stringify(r.upkeepTracks ?? []),
    JSON.stringify(r.enemyCasts ?? []),
    JSON.stringify(r.unclassifiedAuras ?? []),
    r.raidSessionId,
  );
}

export function insertWclPlayerFight(db: DatabaseSync, f: WclPlayerFight): void {
  db.prepare(
    `INSERT INTO wcl_player_fights (
       id, report_code, fight_id, encounter_id, encounter_name, kill, fight_percentage,
       duration_ms, actor_name, character_id, class_name, spec, role, parse_percent,
       bracket_percent, amount, deaths, flask, elixirs_json, late_consumables_json, scrolls_json, food, weapon_buff,
       prepot, prepot_label, death_times_json, potions_json, other_casts_json, extras_json, cooldowns_json, cast_times_json,
       dispels_json, interrupts_json, upkeep_json, gear_json, talents_json, drums, runes, healthstones, sappers, missing_enchants_json, fight_start_ms,
       boss_parse_percent, boss_amount
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    f.id, f.reportCode, f.fightId, f.encounterId, f.encounterName, f.kill ? 1 : 0,
    f.fightPercentage ?? null, f.durationMs, f.actorName, f.characterId, f.className ?? null,
    f.spec ?? null, f.role, f.parsePercent ?? null, f.bracketPercent ?? null, f.amount ?? null,
    f.deaths, f.flask ?? null, JSON.stringify(f.elixirs), JSON.stringify(f.lateConsumables),
    JSON.stringify(f.scrolls), f.food ? 1 : 0,
    f.weaponBuff ? 1 : 0, f.prepot ? 1 : 0, f.prepotLabel ?? null,
    JSON.stringify(f.deathTimes),
    JSON.stringify(f.potions), JSON.stringify(f.otherCasts),
    JSON.stringify(f.extras), JSON.stringify(f.cooldowns), JSON.stringify(f.castTimes),
    JSON.stringify(f.dispels),
    JSON.stringify(f.interrupts),
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
       drums, runes, healthstones, sappers, pet_consumables_json, pet_buffs_seen_json,
       trash_dispels_json, trash_interrupts_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    o.id, o.reportCode, o.actorName, o.characterId,
    JSON.stringify(o.potions), JSON.stringify(o.otherCasts),
    o.drums, o.runes, o.healthstones, o.sappers, JSON.stringify(o.petConsumables),
    JSON.stringify(o.petBuffsSeen),
    JSON.stringify(o.trashDispels),
    JSON.stringify(o.trashInterrupts),
  );

}
