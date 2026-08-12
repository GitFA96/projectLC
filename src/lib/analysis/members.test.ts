import { describe, expect, it } from "vitest";
import { buildMembersView, type MembersViewInput } from "./members";
import type { Character, GuildInvite, GuildRole, Membership } from "@/lib/types";

const NOW = "2026-08-12T10:00:00.000Z";
const GUILD = "g1";

function character(over: Partial<Character> & { id: string; name: string }): Character {
  return {
    guildId: GUILD,
    class: "Warrior",
    spec: "Fury",
    role: "dps",
    status: "main",
    membershipId: null,
    ...over,
  } as Character;
}

function membership(over: Partial<Membership> & { id: string }): Membership {
  return {
    guildId: GUILD,
    accountId: `acc_${over.id}`,
    displayName: over.id,
    isGuildMaster: false,
    roleIds: [],
    joinedAt: NOW,
    ...over,
  } as Membership;
}

function role(id: string, capabilities: string[], baseline = false): GuildRole {
  return { id, guildId: GUILD, name: id, sort: 0, capabilities, baseline } as GuildRole;
}

function invite(over: Partial<GuildInvite> & { id: string; characterId: string }): GuildInvite {
  return {
    guildId: GUILD,
    codeHash: `hash_${over.id}`,
    roleIds: [],
    createdBy: "mem_gm",
    createdAt: NOW,
    expiresAt: "2026-08-26T10:00:00.000Z",
    ...over,
  } as GuildInvite;
}

function view(over: Partial<MembersViewInput> = {}) {
  return buildMembersView(
    { memberships: [], roles: [], roster: [], invites: [], ...over },
    NOW,
  );
}

describe("who is in the guild", () => {
  it("puts owners at the top, where a permissions problem gets fixed", () => {
    const result = view({
      memberships: [
        membership({ id: "m_zoe", displayName: "Zoe" }),
        membership({ id: "m_gm", displayName: "Katze", isGuildMaster: true }),
        membership({ id: "m_abe", displayName: "Abe" }),
      ],
    });
    expect(result.members.map((m) => m.displayName)).toEqual(["Katze", "Abe", "Zoe"]);
    expect(result.ownerCount).toBe(1);
  });

  it("counts the baseline role into what a member can actually do", () => {
    // Nobody's membership lists the baseline, because everybody holds it. A
    // screen that only read roleIds would understate every member on it.
    const result = view({
      memberships: [membership({ id: "m1", roleIds: ["raider"] })],
      roles: [role("member", ["guild.view"], true), role("raider", ["loot.view"])],
    });
    expect(result.members[0].capabilities).toEqual(["guild.view", "loot.view"]);
    // The baseline is not shown as one of their roles — it is not a distinction.
    expect(result.members[0].roles.map((r) => r.id)).toEqual(["raider"]);
  });

  it("says nothing about an owner's capabilities, because they hold all of them", () => {
    const result = view({
      memberships: [membership({ id: "m_gm", isGuildMaster: true, roleIds: ["raider"] })],
      roles: [role("raider", ["loot.view"])],
    });
    expect(result.members[0].capabilities).toEqual([]);
  });

  it("drops a role that was deleted out from under a membership", () => {
    const result = view({
      memberships: [membership({ id: "m1", roleIds: ["raider", "deleted-last-week"] })],
      roles: [role("raider", ["loot.view"])],
    });
    expect(result.members[0].roles.map((r) => r.id)).toEqual(["raider"]);
  });

  it("gathers every character a person plays under the one membership", () => {
    // The alt case, from the other end: one person, three characters, one row.
    const result = view({
      memberships: [membership({ id: "m1", displayName: "Thrainn" })],
      roster: [
        character({ id: "c2", name: "Zzz", membershipId: "m1" }),
        character({ id: "c1", name: "Aaa", membershipId: "m1" }),
        character({ id: "c3", name: "Nobody" }),
      ],
    });
    expect(result.members[0].characters.map((c) => c.name)).toEqual(["Aaa", "Zzz"]);
  });

  it("reports never having signed in as null rather than guessing", () => {
    const result = view({
      memberships: [membership({ id: "m1" }), membership({ id: "m2" })],
      lastSeen: { m1: "2026-08-01T00:00:00.000Z" },
    });
    expect(result.members.map((m) => m.lastSeenAt)).toEqual(["2026-08-01T00:00:00.000Z", null]);
  });
});

describe("who can still be invited", () => {
  it("lists roster characters nobody has claimed", () => {
    const result = view({
      memberships: [membership({ id: "m1" })],
      roster: [character({ id: "c1", name: "Claimed", membershipId: "m1" }), character({ id: "c2", name: "Free" })],
    });
    expect(result.unclaimed.map((c) => c.name)).toEqual(["Free"]);
  });

  it("leaves out anyone with an invitation already in flight", () => {
    // Otherwise an officer issues a second code for the same person, which
    // silently kills the first one they already sent.
    const result = view({
      roster: [character({ id: "c1", name: "Waiting" }), character({ id: "c2", name: "Free" })],
      invites: [invite({ id: "i1", characterId: "c1" })],
    });
    expect(result.unclaimed.map((c) => c.name)).toEqual(["Free"]);
  });

  it("offers them again once the invitation lapses", () => {
    const result = view({
      roster: [character({ id: "c1", name: "Lapsed" })],
      invites: [invite({ id: "i1", characterId: "c1", expiresAt: "2026-08-01T00:00:00.000Z" })],
    });
    expect(result.unclaimed.map((c) => c.name)).toEqual(["Lapsed"]);
    expect(result.invites[0].state).toBe("expired");
  });

  it("leaves pugs out of it", () => {
    // A pug is somebody else's raider who came once. Years of them would bury
    // the handful of people an officer is actually trying to sign up.
    const result = view({
      roster: [character({ id: "c1", name: "Visitor", status: "pug" }), character({ id: "c2", name: "Ours" })],
    });
    expect(result.unclaimed.map((c) => c.name)).toEqual(["Ours"]);
  });
});

describe("invitations in flight", () => {
  it("shows only the unredeemed ones, newest first", () => {
    const result = view({
      roster: [character({ id: "c1", name: "A" }), character({ id: "c2", name: "B" })],
      invites: [
        invite({ id: "old", characterId: "c1", createdAt: "2026-08-01T00:00:00.000Z" }),
        invite({ id: "used", characterId: "c2", redeemedAt: NOW }),
        invite({ id: "new", characterId: "c2", createdAt: "2026-08-11T00:00:00.000Z" }),
      ],
    });
    expect(result.invites.map((i) => i.id)).toEqual(["new", "old"]);
  });

  it("survives the character being deleted after the invite went out", () => {
    // History is unlinked, never destroyed — so this row has to render rather
    // than take the page down with it.
    const result = view({ invites: [invite({ id: "i1", characterId: "gone" })] });
    expect(result.invites[0]).toMatchObject({ characterName: null, wowClass: null });
  });

  it("names the roles it will grant, ignoring ones since deleted", () => {
    const result = view({
      roster: [character({ id: "c1", name: "A" })],
      roles: [role("raider", ["loot.view"])],
      invites: [invite({ id: "i1", characterId: "c1", roleIds: ["raider", "gone"] })],
    });
    expect(result.invites[0].roleNames).toEqual(["raider"]);
  });
});
