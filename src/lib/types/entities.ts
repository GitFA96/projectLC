/**
 * The durable entities, inferred from the canonical zod schemas in
 * `import/schemas.ts`. A change to a schema changes these; they are never
 * written out by hand, so the two can never disagree.
 *
 * Part of `@/lib/types`, which re-exports every one of these — import from
 * there, not from this file, so a type moving between domains costs nothing.
 */

import type { attendanceExemptionSchema, awardDecisionSchema, bossCommentSchema, bossDropSchema, characterCommentSchema, characterSchema, currentGearOverrideSchema, feedbackContextSchema, feedbackReportSchema, gearSetSchema, guildBossDropSchema, guildSchema, itemCommentSchema, itemSchema, lootAwardSchema, raidSessionSchema, slotItemSchema, statBlockSchema, wclPlayerFightSchema, wclPlayerOffPullSchema, wclReportSchema, wclRoleSchema } from "@/lib/import/schemas";
import { z } from "zod";

/* Core entities (inferred from the canonical zod schemas) */
export type Guild = z.infer<typeof guildSchema>;
export type Character = z.infer<typeof characterSchema>;
export type Item = z.infer<typeof itemSchema>;
export type SlotItem = z.infer<typeof slotItemSchema>;
export type StatBlock = z.infer<typeof statBlockSchema>;
export type GearSet = z.infer<typeof gearSetSchema>;
export type CurrentGearOverride = z.infer<typeof currentGearOverrideSchema>;
export type RaidSession = z.infer<typeof raidSessionSchema>;
export type LootAward = z.infer<typeof lootAwardSchema>;
export type AwardDecision = z.infer<typeof awardDecisionSchema>;
export type WclReport = z.infer<typeof wclReportSchema>;
export type WclPlayerFight = z.infer<typeof wclPlayerFightSchema>;
export type WclPlayerOffPull = z.infer<typeof wclPlayerOffPullSchema>;
export type WclGearItem = WclPlayerFight["gear"][number];
/** One enemy ability's cast tally on one boss pull — the interrupt denominator. */
export type WclEnemyCast = WclReport["enemyCasts"][number];
/** One victim of a maintained debuff/buff during a pull, with its up-intervals. */
export type WclUpkeepTarget = NonNullable<WclPlayerFight["upkeep"][number]["targets"]>[number];
export type WclRole = z.infer<typeof wclRoleSchema>;
export type AttendanceExemption = z.infer<typeof attendanceExemptionSchema>;
export type CharacterComment = z.infer<typeof characterCommentSchema>;
export type ItemComment = z.infer<typeof itemCommentSchema>;
export type BossComment = z.infer<typeof bossCommentSchema>;
export type BossDrop = z.infer<typeof bossDropSchema>;
export type GuildBossDrop = z.infer<typeof guildBossDropSchema>;
export type FeedbackReport = z.infer<typeof feedbackReportSchema>;
export type FeedbackContext = z.infer<typeof feedbackContextSchema>;
export type FeedbackStatus = FeedbackReport["status"];
export type FeedbackKind = FeedbackReport["kind"];
export type FeedbackPriority = FeedbackReport["priority"];
