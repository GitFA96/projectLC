import { DatabaseSync } from "node:sqlite";
/**
 * `guild_policy` — every number that encodes a judgement.
 *
 * `sanitizePolicy` is an allowlist, and that is the trap: a field it does not
 * name is dropped on read, so the editor saves, the page reloads, and the value
 * is back to its default with no error anywhere. See change-chains §4b.
 */

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

  // Two shapes again: the tier is a count of raiders, the weight a multiplier.
  // 1 is the floor on the weight because it means "no boost" — below it the
  // top tier would be paid LESS than everyone else, which is not a setting
  // anybody means to save.
  const payback: Record<string, unknown> = {
    ...group(r.payback, ["topTier"] as const, (v) => num(v, 0, 100, "int")),
    ...group(r.payback, ["topWeight"] as const, (v) => num(v, 1, 10)),
  };
  if (Object.keys(payback).length > 0) out.payback = payback;

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
