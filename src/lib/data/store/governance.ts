import { buildMembersView, type MembersView } from "@/lib/analysis/members";
import {
  buildPublicProfile,
  type GuildVisibility,
  type PublicProfile,
} from "@/lib/analysis/public-profile";
import { clampWindows, successionState, type SuccessionState } from "@/lib/auth/succession";
import type { FeedbackReport, GuildAuditEntry } from "@/lib/types";
import type { Repo } from "@/lib/data/repo";
import { compareText } from "@/lib/sort";
import type { StoreContext } from "./context";

/**
 * Who the guild is, seen from outside and from the officer table.
 *
 * Two of these take a `now`: succession and the members view both answer a
 * question about the present — how long has somebody been quiet, has an
 * invitation lapsed — which is why the SQLite backend rebuilds them per call
 * rather than serving them from a model keyed on `data_version`.
 *
 * `getPublicProfile` is the one where an omission is the dangerous mistake. It
 * decides what a signed-out visitor sees, and the layout fetches it, so
 * anything added here is added to the anonymous surface of the site.
 */

export function governanceViews(ctx: StoreContext) {
  const { store, config, feedback, guild, raidSessions, roster } = ctx;
  return {
    /**
     * The guild seen as people rather than characters.
     *
     * `lastSeen` comes in through `config` because it lives on `accounts`,
     * which is deliberately outside the read model: a login must not rebuild
     * the store. The seed backend simply has none, and every member reads as
     * never having signed in — which, for a demo with no accounts, is true.
     */
    /**
     * The face this guild shows the world.
     *
     * The mapping below is the entire public surface — a field that is not
     * copied here cannot reach a stranger, whatever gets added to `Character`
     * or `RaidSession` later. `status` is copied deliberately *nowhere*: main,
     * alt, trial and pug are the guild's opinion of a person, and "who is on
     * trial" is not something Warcraft Logs publishes. See §6.
     */
    /**
     * What has happened to this guild, newest first.
     *
     * Every governance write lands here — the claim, invitations, role changes,
     * ownership, character links, and every use of an operator's break-glass.
     * Until this reader existed the table was **write-only**, which quietly made
     * the argument for break-glass untrue: "an override the guild cannot see is
     * a back door" is only a safeguard if the guild can, in fact, see it.
     */
    async listGuildAudit(): Promise<GuildAuditEntry[]> {
      return [...store.guildAudit].sort((a, b) => compareText(b.at, a.at));
    },

    async getPublicProfile(visibility?: GuildVisibility): Promise<PublicProfile> {
      return buildPublicProfile({
        guild: { name: guild.name, realm: guild.realm, faction: guild.faction, activePhase: guild.activePhase },
        roster: roster
          // Pugs are somebody else's raiders who came once. Publishing them as
          // "our roster" is wrong twice over: it overstates the guild to a
          // recruit, and it publishes another guild's members under this
          // guild's name. Filtered here, where `status` is still in scope —
          // the projection below never receives it, because "who is on trial"
          // is a judgement and not a thing Warcraft Logs prints.
          .filter((c) => c.status !== "pug")
          .map((c) => ({ name: c.name, wowClass: c.class, spec: c.spec, role: c.role })),
        raidNights: raidSessions.map((s) => ({ date: s.date, zones: s.zones })),
        // Overridable so the permissions preview can show all three presets
        // without touching the guild's setting. Read-only by construction:
        // there is no path from here to a write.
        visibility: visibility ?? guild.visibility,
      });
    },

    /**
     * Where this guild stands if its owners go quiet.
     *
     * Built on top of `getMembersView` rather than beside it: that view already
     * expands each member's effective capabilities, and the administrative tier
     * is defined by holding one. Computing them twice from different code is
     * how the banner and the claim button end up disagreeing about who is
     * eligible.
     */
    async getSuccessionState(now?: string): Promise<SuccessionState> {
      const view = await this.getMembersView(now);
      return successionState(
        view.members.map((m) => ({
          membershipId: m.membershipId,
          displayName: m.displayName,
          isOwner: m.isGuildMaster,
          // An owner's capability list is empty by construction (they hold
          // everything implicitly), and owners are excluded from every tier
          // anyway — succession is about a guild with nobody home, not about
          // one owner replacing another.
          capabilities: m.capabilities,
          lastSeenAt: m.lastSeenAt,
        })),
        new Date(now ?? Date.now()),
        clampWindows({
          administrativeDays: guild.successionAdminDays,
          memberDays: guild.successionMemberDays,
        }),
      );
    },

    async getMembersView(now?: string): Promise<MembersView> {
      return buildMembersView(
        {
          memberships: store.memberships,
          roles: store.guildRoles,
          roster,
          invites: store.guildInvites,
          lastSeen: config.membershipLastSeen,
        },
        now ?? new Date().toISOString(),
      );
    },

    async listFeedback(): Promise<FeedbackReport[]> {
      /*
       * Open first, then by how much it matters, then newest.
       *
       * Triage reads top-down, and closed reports are kept only so a fixed bug
       * can be told apart from one nobody looked at. Within the open ones,
       * "major" outranks "minor" — but an untriaged report sits between them
       * rather than at the bottom: it is the one thing on the page that still
       * needs a judgement, and burying it under everything already judged is
       * how a list like this stops being read.
       */
      const rank: Record<FeedbackReport["priority"], number> = { major: 0, unset: 1, minor: 2 };
      return [...feedback].sort((a, b) => {
        if (a.status !== b.status) return a.status === "open" ? -1 : 1;
        if (rank[a.priority] !== rank[b.priority]) return rank[a.priority] - rank[b.priority];
        return compareText(b.createdAt, a.createdAt);
      });
    },
  } satisfies Partial<Repo> & ThisType<Repo>;
}
