import type { Capability } from "@/lib/auth/capabilities";

/**
 * What happens when every owner of a guild goes quiet.
 *
 * Ownership is not a capability, so a guild whose owners all disappear cannot
 * appoint replacements. Co-owners make that rare; this makes it recoverable.
 *
 * Pure over its inputs — no database, no clock of its own — because the whole
 * value of it is being able to ask "what would this say in forty days" without
 * waiting forty days.
 *
 * The escalation is **cumulative, not exclusive**: once a tier unlocks it stays
 * unlocked, and a later tier only widens the pool. That is what covers a guild
 * with owners and plain members but nobody in between — the administrative tier
 * simply never has anyone in it, nothing happens at 30 days, and the member tier
 * opens at 60. No special case, no empty-tier logic.
 */

/** Capabilities that make somebody the guild's own administrator. */
const ADMINISTRATIVE: readonly Capability[] = ["roles.manage", "members.manage"];

export interface SuccessionWindows {
  /** Days of silence before a holder of an administrative capability may claim. */
  administrativeDays: number;
  /** Days before any member may. Always the later of the two. */
  memberDays: number;
}

export const DEFAULT_SUCCESSION_WINDOWS: SuccessionWindows = {
  administrativeDays: 30,
  memberDays: 60,
};

/**
 * The guild may tune these, within limits, and may not switch succession off.
 *
 * Unbounded configuration would let an owner set the window to ten years, which
 * defeats the one protection that exists to guard a guild *from* its owner. The
 * floor is there for the opposite reason: a fortnight's holiday must not cost
 * somebody their guild.
 */
export const SUCCESSION_BOUNDS = { min: 14, max: 180 } as const;

export function clampWindows(input?: Partial<SuccessionWindows>): SuccessionWindows {
  const clamp = (value: number | undefined, fallback: number) => {
    const n = Number.isFinite(value) ? (value as number) : fallback;
    return Math.min(SUCCESSION_BOUNDS.max, Math.max(SUCCESSION_BOUNDS.min, Math.round(n)));
  };
  const administrativeDays = clamp(input?.administrativeDays, DEFAULT_SUCCESSION_WINDOWS.administrativeDays);
  // The member tier can never open before the administrative one; a guild that
  // set it lower would be saying "trust everyone sooner than we trust officers".
  const memberDays = Math.max(
    administrativeDays,
    clamp(input?.memberDays, DEFAULT_SUCCESSION_WINDOWS.memberDays),
  );
  return { administrativeDays, memberDays };
}

export interface SuccessionMember {
  membershipId: string;
  displayName: string;
  isOwner: boolean;
  /** Effective capabilities, implications already expanded. */
  capabilities: readonly Capability[];
  /** ISO, or null when this account has never signed in. */
  lastSeenAt: string | null;
}

export type SuccessionStatus = "healthy" | "warning" | "unlocked" | "ownerless";

export interface SuccessionState {
  status: SuccessionStatus;
  /**
   * The windows this was computed under, already clamped.
   *
   * Returned rather than left to the caller to look up again: the settings form
   * shows the numbers the app is actually acting on, and a guild whose stored
   * row was out of range would otherwise see what it typed instead of what is
   * in force.
   */
  windows: SuccessionWindows;
  /** The most recent moment any owner was seen. Null when none ever has been. */
  quietSince: string | null;
  quietDays: number;
  /** When the administrative tier opens, or opened. */
  administrativeAt: string | null;
  /** When every member becomes eligible. */
  memberAt: string | null;
  /** Who may take ownership right now. Empty unless status is "unlocked". */
  eligible: SuccessionMember[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Warn a third of the way in, so a takeover is never a surprise. */
const WARN_FRACTION = 2 / 3;

function isAdministrative(member: SuccessionMember): boolean {
  return ADMINISTRATIVE.some((c) => member.capabilities.includes(c));
}

/**
 * Where a guild stands.
 *
 * `quietSince` is the *most recent* owner activity, not the oldest: one active
 * owner keeps the whole guild healthy, which is exactly what co-ownership is
 * for. An owner who has never signed in contributes nothing to that maximum,
 * because "never seen" cannot be evidence that somebody is around.
 */
export function successionState(
  members: readonly SuccessionMember[],
  now: Date,
  windows: SuccessionWindows = DEFAULT_SUCCESSION_WINDOWS,
): SuccessionState {
  const owners = members.filter((m) => m.isOwner);
  const empty = { administrativeAt: null, memberAt: null, eligible: [] as SuccessionMember[] };

  if (owners.length === 0) {
    // Should be unreachable — removeGuildOwner refuses to create it — but a
    // guild that got here anyway needs the widest possible pool, not silence.
    return {
      status: "ownerless",
      windows,
      quietSince: null,
      quietDays: Number.POSITIVE_INFINITY,
      ...empty,
      eligible: members.filter((m) => !m.isOwner),
    };
  }

  const seenTimes = owners
    .map((o) => (o.lastSeenAt ? Date.parse(o.lastSeenAt) : Number.NaN))
    .filter((t) => Number.isFinite(t));
  const lastSeen = seenTimes.length > 0 ? Math.max(...seenTimes) : null;

  if (lastSeen === null) {
    // Every owner is an account that has never signed in. Treat it as quiet
    // from now rather than from the beginning of time: the clock starts when
    // somebody notices, not retroactively.
    return { status: "healthy", windows, quietSince: null, quietDays: 0, ...empty };
  }

  const quietDays = Math.max(0, (now.getTime() - lastSeen) / DAY_MS);
  const administrativeAt = new Date(lastSeen + windows.administrativeDays * DAY_MS).toISOString();
  const memberAt = new Date(lastSeen + windows.memberDays * DAY_MS).toISOString();
  const quietSince = new Date(lastSeen).toISOString();

  const eligible = members.filter((m) => {
    if (m.isOwner) return false;
    if (quietDays >= windows.memberDays) return true;
    return quietDays >= windows.administrativeDays && isAdministrative(m);
  });

  let status: SuccessionStatus = "healthy";
  if (eligible.length > 0) status = "unlocked";
  else if (quietDays >= windows.administrativeDays * WARN_FRACTION) status = "warning";

  return { status, windows, quietSince, quietDays, administrativeAt, memberAt, eligible };
}

/** May this specific member take ownership right now? */
export function mayClaimOwnership(state: SuccessionState, membershipId: string): boolean {
  return state.eligible.some((m) => m.membershipId === membershipId);
}
