import { DatabaseSync } from "node:sqlite";
import type { StrandedSimSetting } from "@/lib/types";
import { parseTreePoints, treePointsFromString } from "@/lib/data/db/migrate";
/**
 * `sim_profile:<class>:<spec>`, and the `sim_settings:` keys they replaced.
 *
 * The legacy keys are still read, because a guild that saved settings under the
 * old scheme has them and nothing else does.
 */

export const SIM_PROFILE_PREFIX = "sim_profile:";

/** The per-character key this replaced. Still read, once, by the promotion below. */
const LEGACY_SIM_SETTINGS_PREFIX = "sim_settings:";

export const simProfileKey = (wowClass: string, spec: string) =>
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
