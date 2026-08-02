import { format, parseISO } from "date-fns";
import { PHASES } from "@/lib/constants/wow";
import type { AwardContext } from "@/components/award-item-controls";
import type { Guild, RaidSession } from "@/lib/types";

/**
 * Everything the award dialog needs to file a hand-entered award: the recent
 * raid nights to attach it to, and the zones a brand-new entry can name.
 *
 * Shared by the two places an officer hands something over — a character's
 * profile ("give Thrainn this") and an item's contention page ("this dropped,
 * who gets it") — so both offer the same raids in the same order.
 */

/** Recent raid nights offered without making anyone hunt for one. */
const RECENT_SESSIONS = 12;

/**
 * Everything in an award context except who's winning. A contested item has
 * one of these and many candidate winners, so it ships once and the winner is
 * stamped on at click time.
 */
export type AwardTarget = Omit<AwardContext, "characterId" | "characterName">;

export function buildAwardTarget(guild: Guild, sessions: RaidSession[]): AwardTarget {
  // The active phase's raids lead the zone list — that's where loot is dropping.
  const activePhaseZones = PHASES.find((p) => p.phase === guild.activePhase)?.zones ?? [];
  return {
    sessions: [...sessions]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, RECENT_SESSIONS)
      .map((s) => ({
        id: s.id,
        label: `${format(parseISO(s.date), "d MMM yyyy")} — ${s.zones.join(" + ")}`,
      })),
    zones: [...new Set([...activePhaseZones, ...PHASES.flatMap((p) => p.zones)])],
    defaultZone: activePhaseZones[0] ?? PHASES[0].zones[0],
    today: new Date().toISOString().slice(0, 10),
  };
}

export function buildAwardContext(
  character: { id: string; name: string },
  guild: Guild,
  sessions: RaidSession[],
): AwardContext {
  return {
    ...buildAwardTarget(guild, sessions),
    characterId: character.id,
    characterName: character.name,
  };
}
