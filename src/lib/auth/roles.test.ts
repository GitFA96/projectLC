import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getDataVersion,
  getDb,
  insertGuildRole,
  insertMembership,
  loadStore,
  upsertAccount,
} from "@/lib/data/db";
import { getSqliteRepo } from "@/lib/data/sqlite-repo";
import { baselineViolations, expandCapabilities } from "@/lib/auth/capabilities";
import { createRole, deleteRole, setMemberRoles, updateRole } from "@/lib/auth/roles";

beforeEach(() => {
  process.env.PROJECTLC_DB = path.join(mkdtempSync(path.join(tmpdir(), "projectlc-roles-")), "test.db");
});

const NOW = "2026-08-12T10:00:00.000Z";

function guild() {
  getSqliteRepo();
  const db = getDb();
  const store = loadStore(db);
  return { db, guildId: store.guild.id };
}

/** The starter roles the deployment claim would have written. */
function starterRoles(db: ReturnType<typeof getDb>, guildId: string) {
  insertGuildRole(db, { id: "role_member", guildId, name: "Member", sort: 0, capabilities: ["guild.view", "roster.view"], baseline: true });
  insertGuildRole(db, { id: "role_raider", guildId, name: "Raider", sort: 1, capabilities: ["loot.view"], baseline: false });
  return { baseline: "role_member", raider: "role_raider" };
}

function member(db: ReturnType<typeof getDb>, guildId: string, id: string, name: string, owner = false) {
  const person = upsertAccount(db, { discordId: id, discordUsername: name, now: NOW });
  insertMembership(db, {
    id, guildId, accountId: person.id, displayName: name, isGuildMaster: owner, roleIds: [], joinedAt: NOW,
  });
  return id;
}

const roleById = (db: ReturnType<typeof getDb>, id: string) => loadStore(db).guildRoles.find((r) => r.id === id);

describe("the starter roles are suggestions, not fixtures", () => {
  it("renames and recolours one", async () => {
    const { db, guildId } = guild();
    const { raider } = starterRoles(db, guildId);

    const result = updateRole({ guildId, roleId: raider, draft: { name: "Core Raider", colour: "#8a6a3f" }, actor: "Katze", now: NOW });
    expect(result.ok).toBe(true);
    expect(roleById(db, raider)).toMatchObject({ name: "Core Raider", colour: "#8a6a3f" });
  });

  it("deletes one, and takes it off everybody who held it", async () => {
    // The second half is what fails silently if skipped: a membership pointing
    // at a deleted role id trips validateStore on the next rebuild, minutes
    // later, on an unrelated write.
    const { db, guildId } = guild();
    const { raider } = starterRoles(db, guildId);
    member(db, guildId, "mem_1", "Thrainn");
    setMemberRoles({ guildId, membershipId: "mem_1", roleIds: [raider], actor: "Katze", now: NOW });

    expect(deleteRole({ guildId, roleId: raider, actor: "Katze", now: NOW }).ok).toBe(true);
    expect(roleById(db, raider)).toBeUndefined();
    expect(loadStore(db).memberships.find((m) => m.id === "mem_1")?.roleIds).toEqual([]);
  });

  it("makes up an entirely new one", async () => {
    const { db, guildId } = guild();
    starterRoles(db, guildId);
    const result = createRole({
      guildId,
      draft: { name: "Class Lead", capabilities: ["guides.edit", "sim.edit"] },
      actor: "Katze",
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.capabilities.sort()).toEqual(["guides.edit", "sim.edit"]);
    expect(result.value.baseline).toBe(false);
  });

  it("refuses two roles with the same name, however it is cased", async () => {
    const { db, guildId } = guild();
    starterRoles(db, guildId);
    expect(createRole({ guildId, draft: { name: "  rAiDeR ", capabilities: [] }, actor: "K", now: NOW }))
      .toEqual({ ok: false, reason: "name-taken" });
  });

  it("refuses a nameless role", async () => {
    const { db, guildId } = guild();
    starterRoles(db, guildId);
    expect(createRole({ guildId, draft: { name: "   ", capabilities: [] }, actor: "K", now: NOW }))
      .toEqual({ ok: false, reason: "name-required" });
  });

  it("drops a capability the code no longer knows about", async () => {
    const { db, guildId } = guild();
    starterRoles(db, guildId);
    const result = createRole({
      guildId,
      draft: { name: "Historian", capabilities: ["loot.view", "loot.retconn"] },
      actor: "K",
      now: NOW,
    });
    expect(result.ok && result.value.capabilities).toEqual(["loot.view"]);
  });
});

describe("the baseline role", () => {
  it("can be edited, because what every member gets is the guild's first policy argument", async () => {
    const { db, guildId } = guild();
    const { baseline } = starterRoles(db, guildId);

    const result = updateRole({
      guildId,
      roleId: baseline,
      draft: { name: "Guildie", capabilities: ["guild.view", "roster.view", "logs.view", "comments.write"] },
      actor: "Katze",
      now: NOW,
    });
    expect(result.ok).toBe(true);
    expect(roleById(db, baseline)?.name).toBe("Guildie");
  });

  it("may hold a write the app would not have chosen — that is the guild's call", async () => {
    // Answering this one in code would be the same overreach as shipping loot
    // weights nobody can edit. A guild that runs on trust may want it.
    const { db, guildId } = guild();
    const { baseline } = starterRoles(db, guildId);
    expect(updateRole({ guildId, roleId: baseline, draft: { capabilities: ["loot.award"] }, actor: "K", now: NOW }).ok).toBe(true);
  });

  it("may never hand out permissions, because that empties the whole system", async () => {
    // With roles.manage under every member, any of them grants themselves
    // everything. The permission system still renders and means nothing.
    const { db, guildId } = guild();
    const { baseline } = starterRoles(db, guildId);

    for (const capability of ["roles.manage", "members.manage"]) {
      expect(updateRole({ guildId, roleId: baseline, draft: { capabilities: [capability] }, actor: "K", now: NOW }))
        .toEqual({ ok: false, reason: "baseline-escalation" });
    }
    expect(roleById(db, baseline)?.capabilities).toEqual(["guild.view", "roster.view"]);
  });

  it("catches escalation that arrives through an implication rather than directly", async () => {
    // roles.manage implies members.manage. A check against the raw list would
    // wave through a baseline that reaches escalation one hop later.
    expect(expandCapabilities(["roles.manage"]).has("members.manage")).toBe(true);
    expect(baselineViolations(["roles.manage"]).sort()).toEqual(["members.manage", "roles.manage"]);
  });

  it("is refused wholesale rather than quietly stripped of the offending grant", async () => {
    // Saving something other than what an officer ticked is worse than saying no.
    const { db, guildId } = guild();
    const { baseline } = starterRoles(db, guildId);
    updateRole({ guildId, roleId: baseline, draft: { capabilities: ["logs.view", "members.manage"] }, actor: "K", now: NOW });
    expect(roleById(db, baseline)?.capabilities).toEqual(["guild.view", "roster.view"]);
  });

  it("cannot be deleted — something has to be the floor", async () => {
    const { db, guildId } = guild();
    const { baseline } = starterRoles(db, guildId);
    expect(deleteRole({ guildId, roleId: baseline, actor: "K", now: NOW }))
      .toEqual({ ok: false, reason: "baseline-undeletable" });
  });

  it("is not stored on a membership, because everybody holds it", async () => {
    // Listing it on one row would make it look optional on that row.
    const { db, guildId } = guild();
    const { baseline, raider } = starterRoles(db, guildId);
    member(db, guildId, "mem_1", "Thrainn");

    setMemberRoles({ guildId, membershipId: "mem_1", roleIds: [baseline, raider], actor: "K", now: NOW });
    expect(loadStore(db).memberships.find((m) => m.id === "mem_1")?.roleIds).toEqual([raider]);
  });
});

describe("assigning roles to a member", () => {
  it("refuses an id from another guild rather than saving the part it recognised", async () => {
    const { db, guildId } = guild();
    const { raider } = starterRoles(db, guildId);
    member(db, guildId, "mem_1", "Thrainn");

    expect(setMemberRoles({ guildId, membershipId: "mem_1", roleIds: [raider, "role_elsewhere"], actor: "K", now: NOW }))
      .toEqual({ ok: false, reason: "unknown-role" });
    expect(loadStore(db).memberships.find((m) => m.id === "mem_1")?.roleIds).toEqual([]);
  });

  it("refuses a membership from another guild", async () => {
    const { db, guildId } = guild();
    starterRoles(db, guildId);
    member(db, guildId, "mem_1", "Thrainn");
    expect(setMemberRoles({ guildId: "somewhere-else", membershipId: "mem_1", roleIds: [], actor: "K", now: NOW }))
      .toEqual({ ok: false, reason: "missing" });
  });

  it("cannot take ownership away, because ownership is not a role", async () => {
    const { db, guildId } = guild();
    starterRoles(db, guildId);
    member(db, guildId, "mem_gm", "Katze", true);

    expect(setMemberRoles({ guildId, membershipId: "mem_gm", roleIds: [], actor: "Katze", now: NOW }).ok).toBe(true);
    expect(loadStore(db).memberships.find((m) => m.id === "mem_gm")?.isGuildMaster).toBe(true);
  });
});

describe("what the guild is told happened", () => {
  it("names roles and grants in words, not ids", async () => {
    const { db, guildId } = guild();
    starterRoles(db, guildId);
    createRole({ guildId, draft: { name: "Class Lead", capabilities: ["guides.edit"] }, actor: "Katze", now: NOW });

    const entry = loadStore(db).guildAudit.find((a) => a.kind === "role.created");
    expect(entry?.detail).toContain("Class Lead");
    expect(entry?.detail).toContain("Write class guides");
    expect(entry?.detail).not.toContain("guides.edit");
  });

  it("tells a rename apart from a change of grants", async () => {
    const { db, guildId } = guild();
    const { raider } = starterRoles(db, guildId);
    updateRole({ guildId, roleId: raider, draft: { name: "Core" }, actor: "K", now: NOW });
    updateRole({ guildId, roleId: raider, draft: { capabilities: ["loot.view", "logs.view"] }, actor: "K", now: NOW });

    const kinds = loadStore(db).guildAudit.map((a) => a.kind);
    expect(kinds).toContain("role.renamed");
    expect(kinds).toContain("role.regranted");
  });

  it("says how many people a deleted role was taken from", async () => {
    const { db, guildId } = guild();
    const { raider } = starterRoles(db, guildId);
    member(db, guildId, "mem_1", "A");
    member(db, guildId, "mem_2", "B");
    setMemberRoles({ guildId, membershipId: "mem_1", roleIds: [raider], actor: "K", now: NOW });
    setMemberRoles({ guildId, membershipId: "mem_2", roleIds: [raider], actor: "K", now: NOW });

    deleteRole({ guildId, roleId: raider, actor: "Katze", now: NOW });
    expect(loadStore(db).guildAudit.find((a) => a.kind === "role.deleted")?.detail).toContain("2 members");
  });

  it("bumps the version, so the read model sees the change", async () => {
    const { db, guildId } = guild();
    starterRoles(db, guildId);
    const before = getDataVersion(db);
    createRole({ guildId, draft: { name: "Bench", capabilities: [] }, actor: "K", now: NOW });
    expect(getDataVersion(db)).toBeGreaterThan(before);
  });
});
