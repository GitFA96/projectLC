import { findOpenBreakGlass, getDb, loadStore } from "@/lib/data/db";
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
 */
export async function resolveSignedInViewer(guildId?: string): Promise<Viewer> {
  const account = await currentAccount();
  if (!account) return anonymousViewer();

  const store = loadStore(getDb());
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
  const viewing = guildId ?? store.guild.id;
  const membership = store.memberships.find(
    (m) => m.accountId === account.id && m.guildId === viewing,
  );
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
    const glass = findOpenBreakGlass(getDb(), account.id, viewing);
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
   */
  const baseline = store.guildRoles.find((r) => r.guildId === membership.guildId && r.baseline);
  const held = new Set(membership.roleIds);
  const granted = store.guildRoles
    .filter((r) => r.guildId === membership.guildId && (held.has(r.id) || r.id === baseline?.id))
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
    characterIds: store.roster
      .filter((c) => c.membershipId === membership.id)
      .map((c) => c.id),
  });
}
