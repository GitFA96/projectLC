import { describe, expect, it } from "vitest";
import {
  clampWindows,
  DEFAULT_SUCCESSION_WINDOWS,
  mayClaimOwnership,
  SUCCESSION_BOUNDS,
  successionState,
  type SuccessionMember,
} from "./succession";

const NOW = new Date("2026-08-11T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

function member(over: Partial<SuccessionMember> & { membershipId: string }): SuccessionMember {
  return {
    displayName: over.membershipId,
    isOwner: false,
    capabilities: [],
    lastSeenAt: daysAgo(0),
    ...over,
  };
}

const officer = (id: string, seen: string | null) =>
  member({ membershipId: id, capabilities: ["members.manage"], lastSeenAt: seen });
const plain = (id: string, seen: string | null) =>
  member({ membershipId: id, capabilities: ["roster.view"], lastSeenAt: seen });
const owner = (id: string, seen: string | null) => member({ membershipId: id, isOwner: true, lastSeenAt: seen });

describe("a guild with an active owner", () => {
  it("is healthy, and nobody is eligible", () => {
    const state = successionState([owner("gm", daysAgo(1)), officer("off", daysAgo(0))], NOW);
    expect(state.status).toBe("healthy");
    expect(state.eligible).toEqual([]);
  });

  it("stays healthy while ANY one owner is around", () => {
    // The whole point of co-ownership: one active owner carries the guild, so
    // quietness is measured from the most recent owner, not the oldest.
    const state = successionState([owner("a", daysAgo(400)), owner("b", daysAgo(2))], NOW);
    expect(state.status).toBe("healthy");
    expect(state.quietDays).toBeCloseTo(2, 0);
  });
});

describe("one owner, with officers", () => {
  const members = () => [owner("gm", daysAgo(31)), officer("off", daysAgo(1)), plain("raider", daysAgo(1))];

  it("opens to the administrative tier at 30 days, and to them only", () => {
    const state = successionState(members(), NOW);
    expect(state.status).toBe("unlocked");
    expect(state.eligible.map((m) => m.membershipId)).toEqual(["off"]);
    expect(mayClaimOwnership(state, "off")).toBe(true);
    expect(mayClaimOwnership(state, "raider")).toBe(false);
  });

  it("warns before it unlocks, so a takeover is never a surprise", () => {
    const state = successionState([owner("gm", daysAgo(21)), officer("off", daysAgo(1))], NOW);
    expect(state.status).toBe("warning");
    expect(state.eligible).toEqual([]);
    expect(state.administrativeAt).toBe(new Date(Date.parse(daysAgo(21)) + 30 * 86400000).toISOString());
  });

  it("never lets an owner claim from another owner through this route", () => {
    // Removing an active co-owner is removeGuildOwner's business, with its own
    // rules. Succession is about a guild with nobody home.
    const state = successionState([owner("a", daysAgo(90)), owner("b", daysAgo(90))], NOW);
    expect(state.eligible).toEqual([]);
  });
});

describe("co-owners and plain members, no officers", () => {
  // The case that stranded the earlier design: nobody holds an administrative
  // capability, so the 30-day tier is empty and nothing happens at all.
  const members = (quiet: number) => [
    owner("a", daysAgo(quiet)),
    owner("b", daysAgo(quiet + 10)),
    plain("raider", daysAgo(1)),
    plain("other", daysAgo(1)),
  ];

  it("does nothing at the administrative window, because that tier is empty", () => {
    const state = successionState(members(31), NOW);
    expect(state.eligible).toEqual([]);
    expect(state.status).toBe("warning");
  });

  it("opens to every member at 60 days rather than leaving the guild stuck", () => {
    const state = successionState(members(61), NOW);
    expect(state.status).toBe("unlocked");
    expect(state.eligible.map((m) => m.membershipId).sort()).toEqual(["other", "raider"]);
  });
});

describe("tiers are cumulative", () => {
  it("keeps officers eligible once the member tier opens too", () => {
    const state = successionState(
      [owner("gm", daysAgo(61)), officer("off", daysAgo(1)), plain("raider", daysAgo(1))],
      NOW,
    );
    expect(state.eligible.map((m) => m.membershipId).sort()).toEqual(["off", "raider"]);
  });
});

describe("owners who have never signed in", () => {
  it("starts the clock now rather than at the beginning of time", () => {
    // "Never seen" is not evidence of absence stretching back forever — it is a
    // guild that has just been set up. Treating it as infinitely quiet would
    // unlock a takeover the moment the second member arrives.
    const state = successionState([owner("gm", null), plain("raider", daysAgo(1))], NOW);
    expect(state.status).toBe("healthy");
    expect(state.quietDays).toBe(0);
    expect(state.eligible).toEqual([]);
  });

  it("ignores a never-seen owner when another owner has been around", () => {
    const state = successionState([owner("a", null), owner("b", daysAgo(2))], NOW);
    expect(state.quietSince).toBe(daysAgo(2));
  });
});

describe("an ownerless guild", () => {
  it("opens to everybody, because there is nothing left to protect", () => {
    const state = successionState([plain("raider", daysAgo(1)), officer("off", daysAgo(1))], NOW);
    expect(state.status).toBe("ownerless");
    expect(state.eligible).toHaveLength(2);
  });
});

describe("window configuration", () => {
  it("defaults to 30 and 60", () => {
    expect(clampWindows()).toEqual(DEFAULT_SUCCESSION_WINDOWS);
  });

  it("cannot be used to switch succession off", () => {
    // The protection exists to guard a guild FROM an absent owner; an owner who
    // could set it to ten years would defeat it.
    expect(clampWindows({ administrativeDays: 3650, memberDays: 3650 })).toEqual({
      administrativeDays: SUCCESSION_BOUNDS.max,
      memberDays: SUCCESSION_BOUNDS.max,
    });
  });

  it("cannot be set so short that a holiday costs somebody their guild", () => {
    expect(clampWindows({ administrativeDays: 1, memberDays: 2 })).toEqual({
      administrativeDays: SUCCESSION_BOUNDS.min,
      memberDays: SUCCESSION_BOUNDS.min,
    });
  });

  it("never lets the member tier open before the administrative one", () => {
    const windows = clampWindows({ administrativeDays: 90, memberDays: 30 });
    expect(windows.memberDays).toBe(90);
  });

  it("survives nonsense without throwing", () => {
    expect(clampWindows({ administrativeDays: Number.NaN })).toEqual(DEFAULT_SUCCESSION_WINDOWS);
  });
});
