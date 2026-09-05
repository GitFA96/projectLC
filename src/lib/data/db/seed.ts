import { DatabaseSync } from "node:sqlite";
import { loadSeedStore } from "@/lib/data/seed-data";
import { bumpDataVersion, withTx } from "@/lib/data/db/core";
import {
  insertAttendanceExemption,
  insertCharacter,
  insertCharacterComment,
  insertCurrentGearOverride,
  insertGearSet,
  insertGuild,
  insertItem,
  insertLootAward,
  insertRaidSession,
  insertWclPlayerFight,
  insertWclPlayerOffPull,
  insertWclReport,
} from "@/lib/data/db/entities";
/**
 * What a brand-new database gets.
 *
 * Runs only when the guild table is empty, which is what makes it safe to call
 * on every connection.
 */

export function seedIfEmpty(db: DatabaseSync): void {
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
