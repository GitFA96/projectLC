import { type Capability, expandCapabilities, sanitizeCapabilities } from "./capabilities";

/**
 * Who is asking, resolved against **one guild**.
 *
 * Nothing crosses a guild boundary (docs/guild-and-player-profiles.md §3), so a
 * viewer is never "this person, generally" — it is this person as seen from
 * inside one guild, and a viewer built for one guild grants nothing in another.
 *
 * Deliberately a flat record rather than a discriminated union: every field is
 * independent of the others, and the combinations that look impossible are the
 * interesting ones. An app admin who is also a raider in the guild they are
 * looking at is a real person, not an error state.
 */
export interface Viewer {
  /** null when nobody is signed in. */
  accountId: string | null;
  /**
   * Operates the service. **Grants nothing inside any guild** — that is the
   * whole point of §7. Guild data reaches an app admin through break-glass or
   * not at all.
   */
  appAdmin: boolean;
  /** Their standing in the guild being viewed. null = outsider to this guild. */
  guild: GuildStanding | null;
  /** An app admin's live override, if one is open. See `decide()`. */
  breakGlass: BreakGlass | null;
  /**
   * Auth is off for this deployment: behave exactly as the app did before
   * accounts existed. Every check passes and reports itself as unrestricted, so
   * it can never be mistaken in an audit log for a grant somebody actually made.
   */
  unrestricted: boolean;
}

export interface GuildStanding {
  guildId: string;
  membershipId: string;
  /**
   * Ownership, not a role. Holds every capability implicitly and cannot be
   * stripped of any — otherwise a guild master edits their own row badly and
   * locks the guild out with no recovery short of a database edit.
   */
  isGuildMaster: boolean;
  /** Effective grants: implications already expanded by `memberViewer()`. */
  capabilities: ReadonlySet<Capability>;
  /**
   * The characters this membership has claimed.
   *
   * Self-access is ownership of your own record, **not** a capability — as a
   * grant a guild master could switch it off by accident, and the entire reason
   * a raider logs in disappears.
   */
  characterIds: ReadonlySet<string>;
}

export interface BreakGlass {
  /** Break-glass is opened for one guild at a time. */
  guildId: string;
  /** No reason, no access. Stored, and shown to the guild. */
  reason: string;
  /** ISO. Expired break-glass grants nothing — nobody has to remember to end it. */
  expiresAt: string;
}

/** Signed out, or signed in and a stranger to this guild. Grants nothing. */
export function anonymousViewer(accountId: string | null = null): Viewer {
  return { accountId, appAdmin: false, guild: null, breakGlass: null, unrestricted: false };
}

/**
 * The pre-accounts deployment: one guild, everything permitted, no login.
 *
 * This is what `resolveViewer()` returns until auth is switched on, and it is
 * why step 1 can land without changing any behaviour.
 */
export function unrestrictedViewer(): Viewer {
  return { accountId: null, appAdmin: false, guild: null, breakGlass: null, unrestricted: true };
}

export interface MemberViewerInput {
  accountId: string;
  guildId: string;
  membershipId: string;
  isGuildMaster?: boolean;
  /** Raw grants from the guild's roles; unknown strings are dropped. */
  capabilities?: Iterable<string>;
  characterIds?: Iterable<string>;
  appAdmin?: boolean;
  breakGlass?: BreakGlass | null;
}

export function memberViewer(input: MemberViewerInput): Viewer {
  return {
    accountId: input.accountId,
    appAdmin: input.appAdmin ?? false,
    breakGlass: input.breakGlass ?? null,
    unrestricted: false,
    guild: {
      guildId: input.guildId,
      membershipId: input.membershipId,
      isGuildMaster: input.isGuildMaster ?? false,
      capabilities: expandCapabilities(sanitizeCapabilities(input.capabilities ?? [])),
      characterIds: new Set(input.characterIds ?? []),
    },
  };
}

/** An app admin looking at a guild they are not a member of. */
export function appAdminViewer(accountId: string, breakGlass: BreakGlass | null = null): Viewer {
  return { accountId, appAdmin: true, guild: null, breakGlass, unrestricted: false };
}

/**
 * Auth is opt-in, and off by default.
 *
 * A deployment with no accounts yet is the guild's live officer tool, and it
 * must keep working exactly as it does today — so the flag has to be switched
 * on deliberately, never inferred from "there happens to be a session table".
 */
export function authEnabled(): boolean {
  return process.env.PROJECTLC_AUTH === "on";
}

/**
 * The viewer for this request.
 *
 * With `PROJECTLC_AUTH` off — the default — this is unrestricted, so every
 * check in the app passes and nothing has changed. With it on, the session is
 * resolved for real.
 *
 * `guildId` names which guild the viewer is being resolved against. It is
 * optional only because there is currently one; an account may hold a
 * membership in several, and resolving without naming one would pick between
 * them arbitrarily.
 *
 * The import is **dynamic on purpose**. `resolve.ts` reaches the database and
 * `next/headers`; a static import would pull both into every module that checks
 * a capability, including the pure tests. Same shape `getRepo()` uses to choose
 * a backend.
 */
export async function resolveViewer(guildId?: string): Promise<Viewer> {
  if (!authEnabled()) return unrestrictedViewer();
  try {
    const { resolveSignedInViewer } = await import("@/lib/auth/resolve");
    return await resolveSignedInViewer(guildId);
  } catch {
    // No request context, no database, a torn read — every one of them means we
    // cannot say who is asking, and the only safe answer to that is nobody.
    return anonymousViewer();
  }
}
