/**
 * Who is asking: accounts, sessions, memberships, roles and the audit trail.
 *
 * `AccountRow` is the one hand-written type here — the tenancy table's view of
 * an account, which is not the account itself.
 *
 * Part of `@/lib/types`, which re-exports every one of these — import from
 * there, not from this file, so a type moving between domains costs nothing.
 */

import type { accountSchema, authSessionSchema, guildAuditEntrySchema, guildInviteSchema, guildRoleSchema, membershipSchema } from "@/lib/import/schemas";
import { z } from "zod";
import type { Guild } from "./entities";

/* Identity. See docs/guild-and-player-profiles.md §3. */
export type Account = z.infer<typeof accountSchema>;
export type AuthSession = z.infer<typeof authSessionSchema>;
export type GuildVisibility = Guild["visibility"];
export type GuildRole = z.infer<typeof guildRoleSchema>;
export type Membership = z.infer<typeof membershipSchema>;
export type GuildInvite = z.infer<typeof guildInviteSchema>;
export type GuildAuditEntry = z.infer<typeof guildAuditEntrySchema>;

/**
 * One account as the tenancy console shows it.
 *
 * Lives here rather than beside `listAccounts` in `db.ts` because a *component*
 * renders it, and a component reaching into the data layer for a type is how
 * that import becomes a habit — the boundary is enforced in `eslint.config.mjs`
 * now, and this was the one thing on the wrong side of it. The shape is a view
 * model either way: `liveSessions` and `guildCount` are computed by the query
 * and exist on no table.
 */
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
