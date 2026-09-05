
/**
 * SQLite persistence on Node's built-in driver (node:sqlite) — no native
 * modules to compile. Nested values (slots, stats, zones) are stored as JSON
 * columns; every load re-validates rows against the canonical zod schemas so
 * schema drift surfaces as a loud error, never as a half-rendered page.
 *
 * The database file lives at data/projectlc.db (override: PROJECTLC_DB).
 * A fresh database is seeded from src/data/seed — delete the file to reset.
 */


/*
 * The barrel. Everything that was in this file now lives under `db/`; no
 * import path outside this directory changed, and none should have to.
 *
 * `db/core.ts` is deliberately not re-exported wholesale — `Row` and `opt`
 * are how this layer reads a SQLite row and mean nothing above it.
 */

export * from "@/lib/data/db/schema";
export {
  COLUMN_MIGRATIONS,
  POST_REBUILD_COLUMN_MIGRATIONS,
  type ColumnMigration,
} from "@/lib/data/db/migrate";
export * from "@/lib/data/db/connection";
export * from "@/lib/data/db/meta/prices";
export * from "@/lib/data/db/meta/boards";
export * from "@/lib/data/db/meta/guild-rosters";
export {
  getSimProfile,
  listSimProfiles,
  listStrandedSimSettings,
  setSimProfile,
  type SimProfileRow,
} from "@/lib/data/db/meta/sim-profiles";
export * from "@/lib/data/db/meta/adjustments";
export * from "@/lib/data/db/meta/policy";
export * from "@/lib/data/db/meta/sheets";
export * from "@/lib/data/db/meta/alternatives";
export * from "@/lib/data/db/meta/guides";
export * from "@/lib/data/db/lookups";
export {
  deleteBossComment,
  deleteBossDrop,
  deleteGuildBossDrop,
  deleteItemComment,
  insertAttendanceExemption,
  insertBossComment,
  insertCharacter,
  insertCharacterComment,
  insertCurrentGearOverride,
  insertFeedback,
  insertGearSet,
  insertItemComment,
  insertLootAward,
  insertRaidSession,
  insertWclPlayerFight,
  insertWclPlayerOffPull,
  insertWclReport,
  mergeItems,
  mergeTokenRedemptions,
  setGuildIdentity,
  setGuildVisibility,
  setSuccessionWindows,
  type TokenRedemption,
  unverifyItem,
  upsertBossDrops,
  upsertGuildBossDrop,
} from "@/lib/data/db/entities";
export * from "@/lib/data/db/identity";
export { loadStore } from "@/lib/data/db/rows";
export { bumpDataVersion, getDataVersion, withTx } from "@/lib/data/db/core";
