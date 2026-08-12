import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  CAPABILITY_IDS,
  type Capability,
  expandCapabilities,
  isCapability,
  sanitizeCapabilities,
} from "./capabilities";
import {
  anonymousViewer,
  appAdminViewer,
  type BreakGlass,
  memberViewer,
  unrestrictedViewer,
} from "./viewer";
import {
  AppAdminError,
  can,
  CapabilityError,
  canSeeCharacter,
  decide,
  isAppAdmin,
  ownsCharacter,
  requireAppAdmin,
  requireCapability,
} from "./can";

const GUILD = "guild-1";
const OTHER_GUILD = "guild-2";

const glass = (over: Partial<BreakGlass> = {}): BreakGlass => ({
  guildId: GUILD,
  reason: "raider reports a missing award",
  expiresAt: "2026-08-11T12:00:00.000Z",
  ...over,
});
const DURING = new Date("2026-08-11T11:00:00.000Z");
const AFTER = new Date("2026-08-11T13:00:00.000Z");

const member = (capabilities: string[], over = {}) =>
  memberViewer({ accountId: "a1", guildId: GUILD, membershipId: "m1", capabilities, ...over });

describe("the capability vocabulary", () => {
  it("implies nothing that isn't in the vocabulary", () => {
    for (const id of CAPABILITY_IDS) {
      for (const implied of CAPABILITIES[id].implies ?? []) {
        expect(isCapability(implied), `${id} implies unknown ${implied}`).toBe(true);
      }
    }
  });

  it("gives every capability UI copy, because the grant editor renders it", () => {
    for (const id of CAPABILITY_IDS) {
      expect(CAPABILITIES[id].label.length, id).toBeGreaterThan(0);
      expect(CAPABILITIES[id].gates.length, id).toBeGreaterThan(0);
    }
  });

  it("never implies its way from a write to an unrelated read", () => {
    // import.run writes characters, awards and reports. If it implied the views
    // of everything it touches it would be a back door with a friendly name.
    expect(CAPABILITIES["import.run"].implies).toBeUndefined();
  });

  it("expands implications transitively", () => {
    // roles.manage -> members.manage -> roster.view
    expect([...expandCapabilities(["roles.manage"])].sort()).toEqual(
      ["members.manage", "roles.manage", "roster.view"].sort(),
    );
  });

  it("drops stored grants the code no longer knows about", () => {
    expect(sanitizeCapabilities(["loot.view", "loot.timeTravel", "loot.view"])).toEqual([
      "loot.view",
    ]);
  });
});

describe("deny by default", () => {
  it("denies an anonymous viewer everything", () => {
    for (const id of CAPABILITY_IDS) expect(can(anonymousViewer(), id), id).toBe(false);
  });

  it("denies a capability the code doesn't have, even if it was stored", () => {
    const viewer = member(["loot.view"]);
    expect(can(viewer, "loot.retconEverything" as Capability)).toBe(false);
  });

  it("denies a member every capability they were not granted", () => {
    const viewer = member(["loot.view"]);
    const granted = CAPABILITY_IDS.filter((id) => can(viewer, id));
    expect(granted).toEqual(["loot.view"]);
  });
});

describe("grants", () => {
  it("gives the guild master everything, implicitly", () => {
    const gm = member([], { isGuildMaster: true });
    for (const id of CAPABILITY_IDS) expect(can(gm, id), id).toBe(true);
  });

  it("grants what a role implies as well as what it lists", () => {
    const officer = member(["loot.award"]);
    expect(can(officer, "loot.award")).toBe(true);
    expect(can(officer, "loot.view")).toBe(true);
    expect(can(officer, "roster.view")).toBe(true);
    expect(can(officer, "roster.edit")).toBe(false);
  });

  it("reports the path that granted it", () => {
    expect(decide(member(["loot.view"]), "loot.view").via).toBe("role");
    expect(decide(member([], { isGuildMaster: true }), "loot.view").via).toBe("guild-master");
    expect(decide(unrestrictedViewer(), "loot.view").via).toBe("unrestricted");
  });
});

describe("auth off", () => {
  it("permits everything and says so, so no audit log can mistake it for a real grant", () => {
    const viewer = unrestrictedViewer();
    for (const id of CAPABILITY_IDS) {
      const decision = decide(viewer, id);
      expect(decision.allowed, id).toBe(true);
      expect(decision.via, id).toBe("unrestricted");
      expect(decision.audit, id).toBeNull();
    }
  });
});

describe("nothing crosses a guild boundary", () => {
  it("denies a member of one guild in another", () => {
    const viewer = member(["loot.view", "roster.view"]);
    expect(can(viewer, "loot.view", { guildId: GUILD })).toBe(true);
    expect(can(viewer, "loot.view", { guildId: OTHER_GUILD })).toBe(false);
  });

  it("denies the guild master of one guild in another", () => {
    const gm = member([], { isGuildMaster: true });
    expect(can(gm, "policy.edit", { guildId: OTHER_GUILD })).toBe(false);
  });
});

describe("the app admin is not a super guild master", () => {
  const admin = appAdminViewer("admin-1");

  it("grants an app admin nothing at all inside a guild", () => {
    for (const id of CAPABILITY_IDS) expect(can(admin, id, { guildId: GUILD }), id).toBe(false);
  });

  it("still grants nothing when break-glass is closed", () => {
    expect(can(appAdminViewer("admin-1", null), "loot.view", { guildId: GUILD })).toBe(false);
  });
});

describe("an operator who is also a guild master", () => {
  // The realistic case, and the one the two-account design was built to
  // prevent for no good reason: one person runs the service AND runs a guild.
  const both = member(["loot.view"], { appAdmin: true, isGuildMaster: true });

  it("has every power in their own guild — from the membership, not the flag", () => {
    for (const id of CAPABILITY_IDS) expect(can(both, id, { guildId: GUILD }), id).toBe(true);
    expect(decide(both, "policy.edit", { guildId: GUILD }).via).toBe("guild-master");
  });

  it("has nothing in anybody else's guild, which is the whole promise", () => {
    for (const id of CAPABILITY_IDS) {
      expect(can(both, id, { guildId: OTHER_GUILD }), id).toBe(false);
    }
  });

  it("reaches another guild only through break-glass, and it is recorded", () => {
    const withGlass = member(["loot.view"], {
      appAdmin: true,
      isGuildMaster: true,
      breakGlass: glass({ guildId: OTHER_GUILD }),
    });
    const decision = decide(withGlass, "loot.view", { guildId: OTHER_GUILD, now: DURING });
    expect(decision.allowed).toBe(true);
    expect(decision.via).toBe("break-glass");
    expect(decision.audit?.guildId).toBe(OTHER_GUILD);
  });
});

describe("break-glass", () => {
  const admin = appAdminViewer("admin-1", glass());

  it("grants, and hands back the record the guild's audit log must store", () => {
    const decision = decide(admin, "loot.view", { guildId: GUILD, now: DURING });
    expect(decision.allowed).toBe(true);
    expect(decision.via).toBe("break-glass");
    expect(decision.audit).toEqual(glass());
  });

  it("expires on its own", () => {
    expect(can(admin, "loot.view", { guildId: GUILD, now: AFTER })).toBe(false);
  });

  it("is opened for one guild and grants nothing in another", () => {
    expect(can(admin, "loot.view", { guildId: OTHER_GUILD, now: DURING })).toBe(false);
  });

  it("grants nothing to a member who is not an app admin, however it got set", () => {
    const raider = member(["loot.view"], { breakGlass: glass() });
    expect(can(raider, "policy.edit", { guildId: GUILD, now: DURING })).toBe(false);
  });

  it("is not used when a real grant already covers it, so the log stays honest", () => {
    const officerAdmin = member(["loot.view"], { appAdmin: true, breakGlass: glass() });
    const decision = decide(officerAdmin, "loot.view", { guildId: GUILD, now: DURING });
    expect(decision.via).toBe("role");
    expect(decision.audit).toBeNull();
  });

  it("ignores an unparseable expiry rather than treating it as forever", () => {
    const broken = appAdminViewer("admin-1", glass({ expiresAt: "whenever" }));
    expect(can(broken, "loot.view", { guildId: GUILD, now: DURING })).toBe(false);
  });
});

describe("seeing your own record", () => {
  const raider = member([], { characterIds: ["c1"] });

  it("does not depend on a grant", () => {
    expect(can(raider, "roster.view")).toBe(false);
    expect(ownsCharacter(raider, "c1")).toBe(true);
    expect(canSeeCharacter(raider, "c1")).toBe(true);
  });

  it("does not extend to anybody else", () => {
    expect(ownsCharacter(raider, "c2")).toBe(false);
    expect(canSeeCharacter(raider, "c2")).toBe(false);
  });

  it("is satisfied for everyone by roster.view", () => {
    expect(canSeeCharacter(member(["roster.view"]), "c2")).toBe(true);
  });

  it("is a fact about who plays the character, so break-glass does not confer it", () => {
    const admin = appAdminViewer("admin-1", glass());
    expect(ownsCharacter(admin, "c1")).toBe(false);
    // Support reaches the profile through roster.view, which is the audited path.
    expect(canSeeCharacter(admin, "c1", { guildId: GUILD, now: DURING })).toBe(true);
  });
});

describe("the app-admin axis", () => {
  it("is not reachable through any guild capability", () => {
    // No guild may grant somebody the right to administer the deployment it is
    // hosted on, so there is deliberately no app.* capability to grant.
    expect(CAPABILITY_IDS.filter((id) => id.startsWith("app."))).toEqual([]);
  });

  it("is not conferred by being a guild master", () => {
    expect(isAppAdmin(member([], { isGuildMaster: true }))).toBe(false);
    expect(() => requireAppAdmin(member([], { isGuildMaster: true }))).toThrow(AppAdminError);
  });

  it("is conferred by the flag, and by auth being off", () => {
    expect(isAppAdmin(appAdminViewer("admin-1"))).toBe(true);
    expect(isAppAdmin(unrestrictedViewer())).toBe(true);
    expect(isAppAdmin(anonymousViewer())).toBe(false);
  });
});

describe("requireCapability", () => {
  it("throws on denial, so a forgotten branch fails closed", () => {
    expect(() => requireCapability(anonymousViewer(), "loot.award")).toThrow(CapabilityError);
  });

  it("returns the decision when allowed, break-glass record included", () => {
    const admin = appAdminViewer("admin-1", glass());
    const decision = requireCapability(admin, "loot.view", { guildId: GUILD, now: DURING });
    expect(decision.audit).toEqual(glass());
  });

  it("carries the capability that failed, without leaking it to the raider", () => {
    try {
      requireCapability(anonymousViewer(), "policy.edit");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(CapabilityError);
      expect((e as CapabilityError).capability).toBe("policy.edit");
      expect((e as CapabilityError).message).not.toContain("policy.edit");
    }
  });
});
