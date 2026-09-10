import {
  characterIdsForMembership,
  currentGuildId,
  findMembershipByAccount,
  findOpenBreakGlass,
  getDb,
  listGuildRoles,
} from "@/lib/data/db";
import { currentAccount } from "@/lib/auth/session";
import { anonymousViewer, appAdminViewer, memberViewer, type Viewer } from "@/lib/auth/viewer";

/**
 * Turn a session into a `Viewer`.
 *
 * Split out of `viewer.ts` so that file stays pure — it is imported by every
 * server action, and a static dependency on the database there would drag
 * SQLite into the capability tests. `resolveViewer()` reaches this through a
 * dynamic import, the same shape `getRepo()` uses to pick a backend.
 *
 * Everything here fails **closed**: any question it cannot answer resolves to
 * the anonymous viewer, which is granted nothing.
 *
 * **Reads are narrow on purpose — never `loadStore()` here.** This runs twice
 * on every authenticated request (the layout resolves a viewer for the nav, the
 * page's `pageView()` resolves one for its gate) and `loadStore` parses every
 * item, pull and award through zod. That was ~0.9s a call at one guild's size,
 * so it was the entire cost of a page: every page sat at ~1.5s regardless of
 * what it rendered, and an anonymous request — which returns above, before any
 * of this — answered in 5ms. Four indexed reads answer the same question.
 */
export async function resolveSignedInViewer(guildId?: string): Promise<Viewer> {
  const account = await currentAccount();
  if (!account) return anonymousViewer();

  const db = getDb();
  /*
   * The guild being viewed — not "whichever membership turns up first".
   *
   * One account may belong to many guilds: a raider with a main in one and an
   * alt in another is a normal person, and `memberships_one_per_guild` is
   * UNIQUE on (guild_id, account_id) precisely so that works. So the viewer has
   * to be resolved against a named guild, or it is resolved against an
   * arbitrary one — which would hand somebody their officer powers from guild A
   * while they are looking at guild B.
   *
   * Until routing carries a guild (§9 step 8) there is exactly one, and naming
   * it here is both correct today and the seam that change plugs into.
   */
  const viewing = guildId ?? currentGuildId(db);
  // No guild row is not a state this app reaches — `getDb()` seeds one. If it
  // ever does, nobody is a member of a guild that isn't there.
  if (!viewing) return anonymousViewer(account.id);
  const membership = findMembershipByAccount(db, viewing, account.id);
  if (!membership) {
    // Signed in, but a stranger to this guild: an outsider, not an error. An
    // app admin lands here too, and lands here with nothing — the flag opens
    // the service console and grants no guild capability anywhere. Reaching a
    // guild takes an audited break-glass.
    if (!account.appAdmin) return anonymousViewer(account.id);
    /*
     * An operator with an open, unexpired override for *this* guild.
     *
     * Loaded rather than assumed: the flag on its own is still nothing here,
     * and `decide()` will only act on a break-glass scoped to the guild being
     * viewed. Expiry lives in the query, so a forgotten override simply stops
     * working — nobody has to remember to close it.
     */
    const glass = findOpenBreakGlass(db, account.id, viewing);
    return appAdminViewer(
      account.id,
      glass ? { guildId: glass.guildId, reason: glass.reason, expiresAt: glass.expiresAt } : null,
    );
  }

  /*
   * Effective grants: the baseline every member carries, plus the roles they
   * hold. The baseline is added here rather than being assigned to each
   * membership, so "what can a plain raider see" stays one editable row and
   * nobody can be created without it.
   *
   * Read for this guild and no other. A role from another guild would be
   * "capabilities crossing a boundary", which `validateStore` says never
   * happens; it used to be a `.filter()` a reader had to remember, and is now
   * the query's own `WHERE guild_id = ?`. That check still runs on every
   * read-model rebuild, which every page triggers, so a database that can
   * express the state is still caught loudly.
   */
  const roles = listGuildRoles(db, membership.guildId);
  const baseline = roles.find((r) => r.baseline);
  const held = new Set(membership.roleIds);
  const granted = roles
    .filter((r) => held.has(r.id) || r.id === baseline?.id)
    .flatMap((r) => r.capabilities);

  return memberViewer({
    accountId: account.id,
    // Carried, not conflated: an operator who is also this guild's master gets
    // every guild capability from `isGuildMaster` below, and none of it from
    // this flag. The flag only ever opens the service console.
    appAdmin: account.appAdmin,
    guildId: membership.guildId,
    membershipId: membership.id,
    isGuildMaster: membership.isGuildMaster,
    // memberViewer sanitizes and expands: a capability retired in a release is
    // dropped rather than guessed at, and implications are resolved once.
    capabilities: granted,
    characterIds: characterIdsForMembership(db, membership.id),
  });
}
