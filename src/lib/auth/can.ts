import { type Capability, isCapability } from "./capabilities";
import type { BreakGlass, Viewer } from "./viewer";

/**
 * The one place that answers "may they?".
 *
 * Pure over its arguments, so it is testable without a request, a database or a
 * session — which is what lets every enforcement site in the app get its check
 * in step 1, while the answer is still always yes.
 */

/** How a grant was arrived at. Recorded, so an audit log can say *why*. */
export type GrantPath = "unrestricted" | "guild-master" | "role" | "break-glass";

export interface Decision {
  allowed: boolean;
  /** null when denied. */
  via: GrantPath | null;
  /**
   * Set **only** when `via` is "break-glass".
   *
   * The enforcement layer must write this to the guild's own audit log. Property
   * 4 of §7 is what separates an override from a back door, and it is the one
   * that gets skipped if this is easy to ignore — which is why `decide()`
   * reports the grant path at all, and why every call site should go through
   * `requireCapability()`: when the audit store lands in step 2, that function
   * is the single place the write has to be added.
   */
  audit: BreakGlass | null;
}

const DENIED: Decision = { allowed: false, via: null, audit: null };

export interface DecideOptions {
  /**
   * The guild being read or written.
   *
   * When given, a viewer resolved for a different guild is denied outright.
   * Cheap insurance for the §3 invariant — a member of one guild must never
   * reach another's data because a page forgot which guild it was rendering.
   */
  guildId?: string;
  /** For testing break-glass expiry. Defaults to now. */
  now?: Date;
}

/**
 * Resolve a capability to a decision, with the path that granted it.
 *
 * Order matters: an ordinary grant is checked **before** break-glass, so an app
 * admin who is also a member of the guild uses their real role and does not
 * litter the guild's audit log with overrides they never needed.
 */
export function decide(
  viewer: Viewer,
  capability: Capability,
  options: DecideOptions = {},
): Decision {
  // Deny by default, including anything the vocabulary no longer contains. A
  // capability string can reach here from a stored role row written by an older
  // release; an unknown one is denied, never guessed at.
  if (!isCapability(capability)) return DENIED;

  if (viewer.unrestricted) return { allowed: true, via: "unrestricted", audit: null };

  const standing = viewer.guild;
  const rightGuild = (id: string) => options.guildId === undefined || options.guildId === id;

  if (standing && rightGuild(standing.guildId)) {
    if (standing.isGuildMaster) return { allowed: true, via: "guild-master", audit: null };
    if (standing.capabilities.has(capability)) {
      return { allowed: true, via: "role", audit: null };
    }
  }

  // Being an app admin grants nothing inside a guild. Only an open, unexpired,
  // correctly-scoped break-glass does — and it announces itself.
  const glass = viewer.breakGlass;
  if (viewer.appAdmin && glass && rightGuild(glass.guildId)) {
    const now = options.now ?? new Date();
    const expires = Date.parse(glass.expiresAt);
    if (Number.isFinite(expires) && expires > now.getTime()) {
      return { allowed: true, via: "break-glass", audit: glass };
    }
  }

  return DENIED;
}

/** The everyday check. Use `decide()` when you need to know *how* it was granted. */
export function can(viewer: Viewer, capability: Capability, options?: DecideOptions): boolean {
  return decide(viewer, capability, options).allowed;
}

/**
 * Does this viewer own this character?
 *
 * Not a capability — a raider sees their own wishlist, attendance, awards and
 * standing whatever their roles say, because it is their record. Break-glass
 * deliberately does **not** satisfy this: ownership is a fact about who plays
 * the character, and support looking at somebody's profile is `roster.view`
 * granted through the override, which is the path that gets audited.
 */
export function ownsCharacter(viewer: Viewer, characterId: string): boolean {
  if (viewer.unrestricted) return true;
  return viewer.guild?.characterIds.has(characterId) ?? false;
}

/** A viewer may read a character's own page if they can see the roster, or it is theirs. */
export function canSeeCharacter(
  viewer: Viewer,
  characterId: string,
  options?: DecideOptions,
): boolean {
  return ownsCharacter(viewer, characterId) || can(viewer, "roster.view", options);
}

/**
 * Runs the service. A different axis from every capability above.
 *
 * There is no `app.*` capability and there should never be one: guild roles
 * grant guild capabilities, and no guild may grant somebody the right to
 * administer the deployment they happen to be hosted on. The two vocabularies
 * stay apart so that mistake is unavailable rather than merely discouraged.
 */
export function isAppAdmin(viewer: Viewer): boolean {
  return viewer.unrestricted || viewer.appAdmin;
}

export class AppAdminError extends Error {
  constructor() {
    super("That's an application setting, not a guild one.");
    this.name = "AppAdminError";
  }
}

/** Service-console gate. Throws for the same reason `requireCapability` does. */
export function requireAppAdmin(viewer: Viewer): void {
  if (!isAppAdmin(viewer)) throw new AppAdminError();
}

export class CapabilityError extends Error {
  constructor(readonly capability: Capability) {
    super("You don't have permission to do that.");
    this.name = "CapabilityError";
  }
}

/**
 * Check, or throw.
 *
 * Throwing rather than returning a result is deliberate, and it is the one place
 * this codebase's discriminated-result convention is the wrong shape: a returned
 * boolean that a caller forgets to branch on fails **open**, and the failure is
 * invisible. A throw that a caller forgets to catch fails closed and loudly.
 * Actions already wrap their bodies in try/catch, so the message lands in the
 * existing `{ ok: false }` path with no extra work.
 */
export function requireCapability(
  viewer: Viewer,
  capability: Capability,
  options?: DecideOptions,
): Decision {
  const decision = decide(viewer, capability, options);
  if (!decision.allowed) throw new CapabilityError(capability);
  /*
   * A break-glass writes into the guild's own log the moment it is *used*, not
   * when it was opened.
   *
   * Opening one is an intention; using it is the thing that happened, and the
   * guild is entitled to know which of its data an operator actually touched.
   * Done here rather than at the call site because there are dozens of call
   * sites and every one of them would have to remember — `decide()` sets
   * `audit` only on this path precisely so the write cannot be skipped.
   *
   * Best-effort and deliberately swallowed: refusing a permitted write because
   * the log was unavailable would be the wrong trade. The alternative — no
   * audit and no error — is what this is stopping.
   */
  if (decision.audit) void recordBreakGlassUse(viewer, capability, decision.audit);
  return decision;
}

/** Fire-and-forget so an audit failure cannot fail the action it describes. */
async function recordBreakGlassUse(
  viewer: Viewer,
  capability: Capability,
  glass: BreakGlass,
): Promise<void> {
  try {
    const { getDb, insertGuildAuditEntry } = await import("@/lib/data/db");
    const { randomUUID } = await import("node:crypto");
    insertGuildAuditEntry(getDb(), {
      id: `aud_${randomUUID().slice(0, 12)}`,
      guildId: glass.guildId,
      kind: "break-glass.used",
      actor: "The service operator",
      reason: glass.reason,
      detail: `An operator used "${capability}" in this guild under a break-glass override.`,
      at: new Date().toISOString(),
      expiresAt: glass.expiresAt,
    });
  } catch {
    // The write it describes has already been permitted; losing the line is
    // bad, refusing the officer's action because of it would be worse.
  }
}
