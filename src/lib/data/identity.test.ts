import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import {
  bumpDataVersion,
  countAccounts,
  createAuthSession,
  deleteGuildRole,
  deleteMembership,
  findAccountByDiscordId,
  findAuthSession,
  findInviteByCodeHash,
  findMembershipByAccount,
  guildOwnerIds,
  addGuildOwner,
  removeGuildOwner,
  getAccount,
  getDataVersion,
  loadStore,
  getDb,
  hashToken,
  insertGuildAuditEntry,
  insertGuildInvite,
  insertGuildRole,
  insertMembership,
  purgeExpiredAuthSessions,
  revokeAccountSessions,
  revokeAuthSession,
  setAccountAppAdmin,
  setCharacterMembership,
  setGuildVisibility,
  setSuccessionWindows,
  touchAccountSeen,
  upsertAccount,
} from "@/lib/data/db";
import { getSqliteRepo } from "@/lib/data/sqlite-repo";
import { claimCodeMatches, claimDeployment, deploymentClaimed } from "@/lib/auth/claim";

beforeEach(() => {
  process.env.PROJECTLC_DB = path.join(mkdtempSync(path.join(tmpdir(), "projectlc-id-")), "test.db");
});

const NOW = "2026-08-11T10:00:00.000Z";

function account(db: ReturnType<typeof getDb>, discordId = "discord-1") {
  return upsertAccount(db, { discordId, discordUsername: "fredrik", now: NOW });
}

function membership(guildId: string, accountId: string, over: Record<string, unknown> = {}) {
  return {
    id: "mem_1",
    guildId,
    accountId,
    displayName: "Fredrik",
    isGuildMaster: false,
    roleIds: [],
    joinedAt: NOW,
    ...over,
  };
}

describe("the migration", () => {
  it("adds membership_id to a characters table created before claiming existed", async () => {
    // The CREATE TABLE block only runs on a fresh database, so this is the only
    // path that reaches the user's real one.
    const old = new DatabaseSync(process.env.PROJECTLC_DB!);
    old.exec(`CREATE TABLE characters (
      id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      class TEXT NOT NULL, spec TEXT NOT NULL, role TEXT NOT NULL, off_spec TEXT,
      off_spec_role TEXT, race TEXT, status TEXT NOT NULL, main_character_id TEXT, note TEXT
    )`);
    old.close();

    const repo = getSqliteRepo(); // boots, migrates, seeds
    const roster = await repo.listCharacters();
    expect(roster.length).toBeGreaterThan(0);
    // Every pre-existing character is unclaimed, which is the honest backfill.
    const character = await repo.findCharacterByName(roster[0].character.name);
    expect(character?.membershipId).toBeNull();
  });
});

describe("an app admin is not a super guild master", () => {
  it("may hold a membership — usually does, and that is not the thing being guarded", () => {
    const db = getDb();
    const person = account(db);
    setAccountAppAdmin(db, person.id, true);

    // The old design forbade this with a trigger, on borrowed enterprise
    // reasoning that does not transfer: both principals sat behind one Discord
    // login anyway. What protects a guild is that the flag grants nothing
    // inside one — see the capability tests in src/lib/auth.
    expect(() => insertMembership(db, membership("g1", person.id))).not.toThrow();
    expect(findAccountByDiscordId(db, "discord-1")?.appAdmin).toBe(true);
  });

  it("keeps one account per Discord identity", () => {
    const db = getDb();
    const first = upsertAccount(db, { discordId: "d1", discordUsername: "one", now: NOW });
    const second = upsertAccount(db, { discordId: "d1", discordUsername: "two", now: NOW });
    expect(second.id).toBe(first.id);
    expect(countAccounts(db)).toBe(1);
  });
});

describe("memberships and claims", () => {
  it("unlinks characters rather than deleting them", async () => {
    const repo = getSqliteRepo();
    const db = getDb();
    const guild = (await repo.getGuild()).id;
    const person = account(db);
    insertMembership(db, membership(guild, person.id));

    const roster = await repo.listCharacters();
    const target = (await repo.findCharacterByName(roster[0].character.name))!;
    expect(setCharacterMembership(db, target.id, "mem_1")).toBe(true);

    const result = deleteMembership(db, "mem_1");

    expect(result).toMatchObject({ ok: true, unlinkedCharacters: 1 });
    // Invariant 6: the character and everything it was ever awarded survive.
    const after = await getSqliteRepo().findCharacterByName(target.name);
    expect(after).toBeDefined();
    expect(after?.membershipId).toBeNull();
  });

  it("keeps a claim across an ordinary character edit", async () => {
    const repo = getSqliteRepo();
    const db = getDb();
    const guild = (await repo.getGuild()).id;
    insertMembership(db, membership(guild, account(db).id));
    const roster = await repo.listCharacters();
    const target = (await repo.findCharacterByName(roster[0].character.name))!;
    setCharacterMembership(db, target.id, "mem_1");

    // An officer fixing a spec must not silently unclaim the character —
    // insertCharacter is INSERT OR REPLACE over a fixed column list.
    const updated = await getSqliteRepo().updateCharacter(target.id, {
      name: target.name,
      class: target.class,
      spec: "Fury",
      role: target.role,
      status: target.status,
    });

    expect(updated.ok).toBe(true);
    expect((await getSqliteRepo().findCharacterByName(target.name))?.membershipId).toBe("mem_1");
  });
});

describe("roles", () => {
  it("takes a deleted role off everyone who held it", async () => {
    const repo = getSqliteRepo();
    const db = getDb();
    const guild = (await repo.getGuild()).id;
    insertGuildRole(db, { id: "role_1", guildId: guild, name: "Officer", sort: 0, capabilities: ["loot.award"], baseline: false });
    insertMembership(db, membership(guild, account(db).id, { roleIds: ["role_1"] }));

    expect(deleteGuildRole(db, "role_1").ok).toBe(true);

    // A membership left holding a dangling role id trips validateStore on the
    // next rebuild — minutes later, on an unrelated write, reading as corruption.
    const rows = db.prepare("SELECT role_ids_json FROM memberships").all() as { role_ids_json: string }[];
    expect(JSON.parse(rows[0].role_ids_json)).toEqual([]);
  });

  it("refuses to delete the baseline role", async () => {
    const db = getDb();
    const guild = (await getSqliteRepo().getGuild()).id;
    insertGuildRole(db, { id: "role_base", guildId: guild, name: "Member", sort: 0, capabilities: [], baseline: true });
    expect(deleteGuildRole(db, "role_base")).toMatchObject({ ok: false });
  });
});

describe("the visibility migration", () => {
  it("gives a guild row written before the column existed a closed default", async () => {
    /*
     * The one failure mode nothing else catches. The CREATE TABLE block only
     * runs on a fresh database, so a missing addColumn() line passes every test
     * and breaks the user's real one — and this particular column failing open
     * would publish a guild's roster because it upgraded.
     */
    const old = new DatabaseSync(process.env.PROJECTLC_DB!);
    old.exec(`CREATE TABLE guild (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, realm TEXT NOT NULL,
      faction TEXT NOT NULL, active_phase INTEGER NOT NULL
    )`);
    old.exec(`INSERT INTO guild (id, name, realm, faction, active_phase)
              VALUES ('g1', 'Oilers', 'Spineshatter', 'Horde', 3)`);
    old.close();

    const guild = await getSqliteRepo().getGuild();
    expect(guild.name).toBe("Oilers");
    expect(guild.visibility).toBe("private");
  });

  it("never publishes a pug as one of ours", async () => {
    /*
     * A pug is somebody else's raider who turned up once. Publishing them as
     * this guild's roster is wrong twice: it overstates the guild to a recruit,
     * and it puts another guild's members on this guild's public page. On the
     * real database this was 69 rows out of 114.
     *
     * The filter lives in the store mapping rather than in the pure projection,
     * because the projection is never handed `status` at all — "who is a pug"
     * is a judgement, and judgements do not cross into the public face.
     */
    const repo = getSqliteRepo();
    setGuildVisibility(getDb(), "recruiting");
    const store = loadStore(getDb());
    const pugs = store.roster.filter((c) => c.status === "pug").map((c) => c.name);
    const profile = await getSqliteRepo().getPublicProfile();
    const published = new Set(profile.roster?.map((c) => c.name) ?? []);

    expect(pugs.filter((name) => published.has(name))).toEqual([]);
    expect(profile.rosterSize).toBe(store.roster.length - pugs.length);
    expect(await repo.getGuild()).toBeTruthy();
  });

  it("publishes nothing at all on that default", async () => {
    const repo = getSqliteRepo();
    const profile = await repo.getPublicProfile();
    expect(profile.roster).toBeNull();
    expect(profile.raidNights).toBeNull();
    // Still identifiable, or an invite link lands nowhere recognisable.
    expect(profile.name).toBe((await repo.getGuild()).name);
  });
});

describe("succession windows", () => {
  it("survives a guild row written before the columns existed", async () => {
    // Same failure mode as every migration here: CREATE TABLE only runs on a
    // fresh database, so a missing addColumn() breaks only the real one.
    const old = new DatabaseSync(process.env.PROJECTLC_DB!);
    old.exec(`CREATE TABLE guild (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, realm TEXT NOT NULL,
      faction TEXT NOT NULL, active_phase INTEGER NOT NULL
    )`);
    old.exec(`INSERT INTO guild (id, name, realm, faction, active_phase)
              VALUES ('g1', 'Oilers', 'Spineshatter', 'Horde', 3)`);
    old.close();

    const state = await getSqliteRepo().getSuccessionState();
    expect(state.windows).toEqual({ administrativeDays: 30, memberDays: 60 });
  });

  it("reports the windows actually in force, not the row as typed", async () => {
    // A row that arrived by hand or from an older release is brought into range
    // on read. The settings form shows what the app will act on.
    const repo = getSqliteRepo();
    const db = getDb();
    setSuccessionWindows(db, 1, 3650);
    const state = await getSqliteRepo().getSuccessionState();
    expect(state.windows.administrativeDays).toBe(14);
    expect(state.windows.memberDays).toBe(180);
    expect(await repo.getGuild()).toBeTruthy();
  });

  it("is healthy while the one owner has just been seen", async () => {
    const db = getDb();
    const guild = (await getSqliteRepo().getGuild()).id;
    const person = account(db, "owner");
    insertMembership(db, membership(guild, person.id, { id: "mem_owner", isGuildMaster: true }));
    // insertMembership does not bump on its own — every real caller does it as
    // part of its own transaction. Without this the cached read model still has
    // no memberships and the guild reads as ownerless.
    bumpDataVersion(db);
    touchAccountSeen(db, person.id, new Date().toISOString());

    const state = await getSqliteRepo().getSuccessionState();
    expect(state.status).toBe("healthy");
    expect(state.eligible).toEqual([]);
  });

  it("opens to a plain member once every owner has been quiet long enough", async () => {
    const db = getDb();
    const guild = (await getSqliteRepo().getGuild()).id;
    const owner = account(db, "owner");
    const raider = account(db, "raider");
    insertMembership(db, membership(guild, owner.id, { id: "mem_owner", isGuildMaster: true }));
    insertMembership(db, membership(guild, raider.id, { id: "mem_raider" }));
    bumpDataVersion(db);
    const longAgo = new Date(Date.now() - 200 * 86400000).toISOString();
    touchAccountSeen(db, owner.id, longAgo);
    touchAccountSeen(db, raider.id, new Date().toISOString());

    const state = await getSqliteRepo().getSuccessionState();
    expect(state.status).toBe("unlocked");
    expect(state.eligible.map((m) => m.membershipId)).toEqual(["mem_raider"]);
    // The owner is never eligible against themselves — succession is about a
    // guild with nobody home, not one owner replacing another.
    expect(state.eligible.some((m) => m.membershipId === "mem_owner")).toBe(false);
  });
});

describe("invites", () => {
  it("stores only the hash of the code it handed out", async () => {
    const repo = getSqliteRepo();
    const db = getDb();
    const guild = (await repo.getGuild()).id;
    const target = (await repo.findCharacterByName((await repo.listCharacters())[0].character.name))!;
    const code = "join-thrainn-8412";

    insertGuildInvite(db, {
      id: "inv_1", guildId: guild, characterId: target.id, codeHash: hashToken(code),
      roleIds: [], createdBy: "system", createdAt: NOW, expiresAt: "2026-08-18T10:00:00.000Z",
    });

    const raw = db.prepare("SELECT code_hash FROM guild_invites").all() as { code_hash: string }[];
    expect(raw[0].code_hash).not.toContain(code);
    expect(findInviteByCodeHash(db, hashToken(code))?.id).toBe("inv_1");
    expect(findInviteByCodeHash(db, hashToken("wrong"))).toBeUndefined();
  });
});

describe("sessions", () => {
  it("stores the hash of the cookie, never the cookie", () => {
    const db = getDb();
    const person = account(db);
    const token = "a-very-secret-cookie-value";
    createAuthSession(db, {
      tokenHash: hashToken(token), accountId: person.id, createdAt: NOW,
      expiresAt: "2026-09-11T10:00:00.000Z",
    });

    const raw = db.prepare("SELECT id FROM auth_sessions").all() as { id: string }[];
    expect(raw[0].id).not.toContain(token);
    expect(findAuthSession(db, hashToken(token))?.accountId).toBe(person.id);
  });

  it("keeps a revoked row so a leaked cookie stays dead", () => {
    const db = getDb();
    const person = account(db);
    createAuthSession(db, { tokenHash: "h1", accountId: person.id, createdAt: NOW, expiresAt: "2026-09-11T10:00:00.000Z" });

    revokeAuthSession(db, "h1", NOW);

    const found = findAuthSession(db, "h1");
    expect(found).toBeDefined();
    expect(found?.revokedAt).toBe(NOW);
  });

  it("revokes every session an account holds at once", () => {
    const db = getDb();
    const person = account(db);
    for (const h of ["h1", "h2", "h3"]) {
      createAuthSession(db, { tokenHash: h, accountId: person.id, createdAt: NOW, expiresAt: "2026-09-11T10:00:00.000Z" });
    }
    expect(revokeAccountSessions(db, person.id)).toBe(3);
    expect(revokeAccountSessions(db, person.id)).toBe(0); // already revoked
  });

  it("purges rows that can never authenticate anything again", () => {
    const db = getDb();
    const person = account(db);
    createAuthSession(db, { tokenHash: "old", accountId: person.id, createdAt: NOW, expiresAt: "2026-01-01T00:00:00.000Z" });
    createAuthSession(db, { tokenHash: "live", accountId: person.id, createdAt: NOW, expiresAt: "2027-01-01T00:00:00.000Z" });

    expect(purgeExpiredAuthSessions(db, NOW)).toBe(1);
    expect(findAuthSession(db, "live")).toBeDefined();
  });

  it("does not bump data_version — a login must not rebuild the read model", async () => {
    const repo = getSqliteRepo();
    await repo.getGuild(); // force a first read model
    const db = getDb();
    const person = account(db);
    const before = getDataVersion(db);

    createAuthSession(db, { tokenHash: "h1", accountId: person.id, createdAt: NOW, expiresAt: "2027-01-01T00:00:00.000Z" });
    revokeAuthSession(db, "h1", NOW);
    upsertAccount(db, { discordId: "discord-1", discordUsername: "renamed", now: NOW });

    // Sessions and accounts are outside the read model. If this ever fails,
    // every sign-in is rebuilding the entire in-memory store.
    expect(getDataVersion(db)).toBe(before);
  });
});

describe("accounts", () => {
  it("creates on first sight and refreshes display fields on every sight", () => {
    const db = getDb();
    const first = upsertAccount(db, { discordId: "d1", discordUsername: "old", now: NOW });
    const second = upsertAccount(db, { discordId: "d1", discordUsername: "new", now: "2026-08-12T10:00:00.000Z" });

    expect(second.id).toBe(first.id);
    expect(countAccounts(db)).toBe(1);
    expect(findAccountByDiscordId(db, "d1")?.discordUsername).toBe("new");
  });

  it("never grants app_admin as a side effect of signing in", () => {
    const db = getDb();
    const person = upsertAccount(db, { discordId: "d1", now: NOW });
    setAccountAppAdmin(db, person.id, true);

    // Signing in again finds the same row and refreshes its display fields.
    // What it must never do is clear the flag: signing in is not a place where
    // privilege changes, in either direction.
    const again = upsertAccount(db, { discordId: "d1", discordUsername: "again", now: NOW });
    expect(again.id).toBe(person.id);
    expect(findAccountByDiscordId(db, "d1")?.appAdmin).toBe(true);
    expect(findAccountByDiscordId(db, "d1")?.discordUsername).toBe("again");
  });

  it("counts nothing on a fresh deployment, which is what the claim flow keys on", () => {
    expect(countAccounts(getDb())).toBe(0);
  });

  it("looks an account up by its own id, not whichever row comes first", () => {
    const db = getDb();
    const first = upsertAccount(db, { discordId: "d1", discordUsername: "one", now: NOW });
    const second = upsertAccount(db, { discordId: "d2", discordUsername: "two", now: NOW });
    expect(getAccount(db, second.id)?.discordUsername).toBe("two");
    expect(getAccount(db, first.id)?.discordUsername).toBe("one");
    expect(getAccount(db, "acc_nope")).toBeUndefined();
  });
});

describe("the guild audit log", () => {
  it("is append-only and lands in the guild's own data", async () => {
    const repo = getSqliteRepo();
    const db = getDb();
    const guild = (await repo.getGuild()).id;

    insertGuildAuditEntry(db, {
      id: "aud_1", guildId: guild, kind: "break-glass.open", actor: "support (app admin)",
      reason: "raider reports a missing award", at: NOW, expiresAt: "2026-08-11T12:00:00.000Z",
    });

    const rows = db.prepare("SELECT * FROM guild_audit WHERE guild_id = ?").all(guild) as { kind: string; reason: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe("raider reports a missing award");
  });
});

describe("claiming the deployment", () => {
  it("creates one account that is both operator and guild master", async () => {
    const repo = getSqliteRepo();
    const guildId = (await repo.getGuild()).id;

    const result = claimDeployment({ discordId: "d1", discordUsername: "Fredrik", now: NOW });

    const db = getDb();
    expect(countAccounts(db)).toBe(1);
    const person = findAccountByDiscordId(db, "d1");
    expect(person?.id).toBe(result.accountId);
    expect(person?.appAdmin).toBe(true);

    const store = loadStore(db);
    const gm = store.memberships.find((m) => m.isGuildMaster);
    expect(gm?.accountId).toBe(result.accountId);
    expect(gm?.guildId).toBe(guildId);

    // Exactly one baseline role, granting the conservative starting set.
    const baseline = store.guildRoles.filter((r) => r.baseline);
    expect(baseline).toHaveLength(1);
    expect(baseline[0].capabilities).toEqual(["guild.view", "roster.view"]);
  });

  it("records itself in the guild's audit log", async () => {
    const repo = getSqliteRepo();
    claimDeployment({ discordId: "d1", discordUsername: "Founder", now: NOW });
    void repo;
    const entry = loadStore(getDb()).guildAudit.find((e) => e.kind === "deployment.claimed");
    expect(entry?.actor).toBe("Founder");
  });

  it("closes once claimed, so a stale claim link cannot re-open it", () => {
    getSqliteRepo();
    claimDeployment({ discordId: "d1", now: NOW });
    expect(deploymentClaimed()).toBe(true);
    expect(() => claimDeployment({ discordId: "d2", now: NOW })).toThrow(/already been claimed/i);
  });

  it("is open only while nobody holds an account", () => {
    getSqliteRepo();
    expect(deploymentClaimed()).toBe(false);
  });

  it("matches its code in constant time and rejects a near miss", () => {
    process.env.PROJECTLC_CLAIM_CODE = "abc123";
    expect(claimCodeMatches("abc123")).toBe(true);
    expect(claimCodeMatches(" abc123 ")).toBe(true); // pasted with whitespace
    expect(claimCodeMatches("abc124")).toBe(false);
    expect(claimCodeMatches("abc12")).toBe(false); // length mismatch, no throw
    expect(claimCodeMatches("")).toBe(false);
    delete process.env.PROJECTLC_CLAIM_CODE;
  });
});

describe("a second membership for the same account", () => {
  it("is refused loudly rather than silently orphaning character claims", async () => {
    const repo = getSqliteRepo();
    const guildId = (await repo.getGuild()).id;
    const db = getDb();
    const acc = upsertAccount(db, { discordId: "d9", now: NOW });
    insertMembership(db, {
      id: "mem_old", guildId, accountId: acc.id, displayName: "A",
      isGuildMaster: false, roleIds: [], joinedAt: NOW,
    });
    const target = (await repo.findCharacterByName((await repo.listCharacters())[0].character.name))!;
    setCharacterMembership(db, target.id, "mem_old");

    // Under INSERT OR REPLACE this quietly deleted mem_old, left the character
    // pointing at it, and made the NEXT read model rebuild throw — a hard boot
    // failure on an unrelated write, minutes later.
    expect(() =>
      insertMembership(db, {
        id: "mem_new", guildId, accountId: acc.id, displayName: "A",
        isGuildMaster: false, roleIds: [], joinedAt: NOW,
      }),
    ).toThrow();

    expect(() => loadStore(db)).not.toThrow();
    expect(findMembershipByAccount(db, guildId, acc.id)?.id).toBe("mem_old");
  });
});

describe("one person, several guilds", () => {
  it("lets one account hold a membership in each guild", async () => {
    const repo = getSqliteRepo();
    const db = getDb();
    const guildA = (await repo.getGuild()).id;
    const acc = upsertAccount(db, { discordId: "d-hardcore", discordUsername: "Raider", now: NOW });

    // A main here, an alt somewhere else: a normal person, not an edge case.
    insertMembership(db, {
      id: "mem_a", guildId: guildA, accountId: acc.id, displayName: "Raider",
      isGuildMaster: false, roleIds: [], joinedAt: NOW,
    });
    insertMembership(db, {
      id: "mem_b", guildId: "guild-two", accountId: acc.id, displayName: "Raider (alt)",
      isGuildMaster: false, roleIds: [], joinedAt: NOW,
    });

    expect(findMembershipByAccount(db, guildA, acc.id)?.id).toBe("mem_a");
    expect(findMembershipByAccount(db, "guild-two", acc.id)?.id).toBe("mem_b");
    // What is forbidden is two memberships in the SAME guild, which is what
    // would orphan character claims.
    expect(() =>
      insertMembership(db, {
        id: "mem_dupe", guildId: guildA, accountId: acc.id, displayName: "Raider",
        isGuildMaster: false, roleIds: [], joinedAt: NOW,
      }),
    ).toThrow();
  });

  it("keeps each guild's characters with the membership that belongs to it", async () => {
    const repo = getSqliteRepo();
    const db = getDb();
    const guildA = (await repo.getGuild()).id;
    const acc = upsertAccount(db, { discordId: "d-hardcore", now: NOW });
    insertMembership(db, {
      id: "mem_a", guildId: guildA, accountId: acc.id, displayName: "R",
      isGuildMaster: false, roleIds: [], joinedAt: NOW,
    });
    const target = (await repo.findCharacterByName((await repo.listCharacters())[0].character.name))!;
    setCharacterMembership(db, target.id, "mem_a");

    // Self-access follows the membership, so it is guild-scoped for free: the
    // other guild's membership owns none of these characters.
    const store = loadStore(db);
    const ownedInA = store.roster.filter((c) => c.membershipId === "mem_a");
    const ownedInB = store.roster.filter((c) => c.membershipId === "mem_b");
    expect(ownedInA).toHaveLength(1);
    expect(ownedInB).toHaveLength(0);
  });
});

describe("one person, several characters in the same guild", () => {
  it("hangs a main and its alts off a single membership", async () => {
    const repo = getSqliteRepo();
    const db = getDb();
    const guildId = (await repo.getGuild()).id;
    const acc = upsertAccount(db, { discordId: "d-alts", discordUsername: "Raider", now: NOW });
    insertMembership(db, {
      id: "mem_one", guildId, accountId: acc.id, displayName: "Raider",
      isGuildMaster: false, roleIds: [], joinedAt: NOW,
    });

    // One membership per guild is the rule; how many characters hang off it is
    // unbounded. A main and three alts is one person, not four.
    const roster = await repo.listCharacters();
    const mine = roster.slice(0, 4);
    for (const row of mine) {
      const character = (await repo.findCharacterByName(row.character.name))!;
      expect(setCharacterMembership(db, character.id, "mem_one")).toBe(true);
    }

    const owned = loadStore(db).roster.filter((c) => c.membershipId === "mem_one");
    expect(owned).toHaveLength(4);
    // Loot still scores per character — one person owning four does not merge
    // their standings. See the design doc: priority follows the character.
    expect(new Set(owned.map((c) => c.id)).size).toBe(4);
  });
});

describe("co-ownership", () => {
  async function guildWith() {
    const repo = getSqliteRepo();
    const guildId = (await repo.getGuild()).id;
    const db = getDb();
    claimDeployment({ discordId: "d1", discordUsername: "Founder", now: NOW });
    const founder = loadStore(db).memberships.find((m) => m.isGuildMaster)!;
    const second = upsertAccount(db, { discordId: "d2", discordUsername: "Second", now: NOW });
    insertMembership(db, {
      id: "mem_second", guildId, accountId: second.id, displayName: "Second",
      isGuildMaster: false, roleIds: [], joinedAt: NOW,
    });
    return { db, guildId, founderId: founder.id, secondAccountId: second.id };
  }

  it("lets a guild have several owners", async () => {
    const { db, guildId, founderId } = await guildWith();
    expect(addGuildOwner(db, guildId, "mem_second", { name: "Founder" })).toMatchObject({ ok: true });
    expect(guildOwnerIds(db, guildId).sort()).toEqual([founderId, "mem_second"].sort());
  });

  it("never lets the last owner go", async () => {
    const { db, guildId, founderId } = await guildWith();
    const result = removeGuildOwner(db, guildId, founderId, { name: "Founder", membershipId: founderId });
    expect(result).toMatchObject({ ok: false });
    expect(guildOwnerIds(db, guildId)).toEqual([founderId]);
  });

  it("lets an owner step down once somebody else owns it too", async () => {
    const { db, guildId, founderId } = await guildWith();
    addGuildOwner(db, guildId, "mem_second", { name: "Founder" });
    expect(
      removeGuildOwner(db, guildId, founderId, { name: "Founder", membershipId: founderId }),
    ).toMatchObject({ ok: true });
    expect(guildOwnerIds(db, guildId)).toEqual(["mem_second"]);
  });

  it("refuses to let one owner push out another who is still active", async () => {
    const { db, guildId, founderId, secondAccountId } = await guildWith();
    addGuildOwner(db, guildId, "mem_second", { name: "Founder" });
    touchAccountSeen(db, secondAccountId, NOW);

    // Otherwise co-ownership is a race to remove the other person first.
    const result = removeGuildOwner(
      db, guildId, "mem_second",
      { name: "Founder", membershipId: founderId },
      { inactiveDays: 30, now: new Date(NOW) },
    );
    expect(result).toMatchObject({ ok: false });
    expect(guildOwnerIds(db, guildId)).toHaveLength(2);
  });

  it("lets one owner remove another who has gone quiet", async () => {
    const { db, guildId, founderId, secondAccountId } = await guildWith();
    addGuildOwner(db, guildId, "mem_second", { name: "Founder" });
    touchAccountSeen(db, secondAccountId, "2026-05-01T00:00:00.000Z"); // ~100 days

    const result = removeGuildOwner(
      db, guildId, "mem_second",
      { name: "Founder", membershipId: founderId, reason: "inactive since May" },
      { inactiveDays: 30, now: new Date(NOW) },
    );
    expect(result).toMatchObject({ ok: true });
    expect(guildOwnerIds(db, guildId)).toEqual([founderId]);
  });

  it("lets the app admin arbitrate a stalemate between two active owners", async () => {
    const { db, guildId, secondAccountId } = await guildWith();
    addGuildOwner(db, guildId, "mem_second", { name: "Founder" });
    touchAccountSeen(db, secondAccountId, NOW);

    // No membershipId on the actor = the operator. Arbitrating exactly this is
    // what an operator is for, and the guild sees it in their audit log.
    const result = removeGuildOwner(
      db, guildId, "mem_second",
      { name: "support (operator)", reason: "ownership dispute, ticket 41" },
      { inactiveDays: 30, now: new Date(NOW) },
    );
    expect(result).toMatchObject({ ok: true });
  });

  it("writes every ownership change into the guild's own audit log", async () => {
    const { db, guildId, founderId } = await guildWith();
    addGuildOwner(db, guildId, "mem_second", { name: "Founder", reason: "co-GM" });
    removeGuildOwner(db, guildId, founderId, { name: "Founder", membershipId: founderId });

    const kinds = loadStore(db).guildAudit.map((e) => e.kind);
    expect(kinds).toContain("owner.added");
    expect(kinds).toContain("owner.stepped-down");
  });

  it("refuses to delete an owner's membership without demoting them first", async () => {
    const { db, guildId, founderId } = await guildWith();
    addGuildOwner(db, guildId, "mem_second", { name: "Founder" });
    expect(deleteMembership(db, founderId)).toMatchObject({ ok: false });

    removeGuildOwner(db, guildId, founderId, { name: "Founder", membershipId: founderId });
    expect(deleteMembership(db, founderId)).toMatchObject({ ok: true });
  });

});

describe("claiming cannot be locked out by an ordinary sign-in", () => {
  it("stays unclaimed when an account exists but owns nothing", () => {
    getSqliteRepo();
    // Exactly what the sign-in button did before the claim: an account row and
    // nothing else. Keying "claimed" on the row count made this a one-click
    // brick — the claim page closed forever with no guild master in existence.
    upsertAccount(getDb(), { discordId: "drive-by", now: NOW });

    expect(countAccounts(getDb())).toBe(1);
    expect(deploymentClaimed()).toBe(false);
  });

  it("is claimed once somebody owns the guild", () => {
    getSqliteRepo();
    claimDeployment({ discordId: "d1", discordUsername: "Founder", now: NOW });
    expect(deploymentClaimed()).toBe(true);
  });

  it("goes back to unclaimed if the last owner is somehow demoted", async () => {
    const guildId = (await getSqliteRepo().getGuild()).id;
    const db = getDb();
    claimDeployment({ discordId: "d1", now: NOW });
    const owner = loadStore(db).memberships.find((m) => m.isGuildMaster)!;
    // removeGuildOwner refuses this, so it takes a raw write to reach — but if
    // a guild ever does end up ownerless, the claim page is the way back in.
    db.prepare("UPDATE memberships SET is_guild_master = 0 WHERE id = ?").run(owner.id);
    void guildId;

    expect(deploymentClaimed()).toBe(false);
  });
});

describe("the class_guides → guides migration", () => {
  /**
   * A key change, not a column, so `addColumn` cannot do it and the CREATE
   * TABLE block will not either — it only runs on a fresh database. A guild's
   * written guides are exactly the sort of thing nobody notices is gone until
   * they go looking for it months later.
   */
  function legacyDatabase(rows: [string, string, string][]): void {
    const old = new DatabaseSync(process.env.PROJECTLC_DB!);
    old.exec(`CREATE TABLE guild (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, realm TEXT NOT NULL,
      faction TEXT NOT NULL, active_phase INTEGER NOT NULL
    )`);
    old.exec(`INSERT INTO guild (id, name, realm, faction, active_phase)
              VALUES ('g1', 'Oilers', 'Spineshatter', 'Horde', 3)`);
    old.exec(`CREATE TABLE class_guides (
      wow_class TEXT NOT NULL, spec TEXT NOT NULL, body TEXT NOT NULL,
      sources TEXT, author TEXT, updated_at TEXT NOT NULL,
      PRIMARY KEY (wow_class, spec)
    )`);
    for (const [wowClass, spec, body] of rows) {
      old
        .prepare(
          `INSERT INTO class_guides (wow_class, spec, body, sources, author, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(wowClass, spec, body, "https://example.com/a", "Fredrik", "2026-01-01T00:00:00.000Z");
    }
    old.close();
  }

  it("carries every guide across, filed under the guild that wrote it", async () => {
    legacyDatabase([
      ["Warrior", "", "Show up enchanted."],
      ["Warrior", "Fury", "Haste potion with Bloodlust."],
    ]);

    const guides = await getSqliteRepo().listGuides();
    expect(guides).toHaveLength(2);
    // Nobody becomes the operator's shared baseline by accident: every existing
    // guide was written by the guild, so that is who owns it.
    expect(guides.every((g) => g.owner === "g1")).toBe(true);
    expect(guides.every((g) => g.kind === "class")).toBe(true);
    expect(guides.find((g) => g.section === "Fury")?.body).toBe("Haste potion with Bloodlust.");
    // The detail most likely to be dropped by a hand-written copy.
    expect(guides.find((g) => g.section === "")?.sources).toEqual(["https://example.com/a"]);
    expect(guides.find((g) => g.section === "")?.author).toBe("Fredrik");
  });

  it("drops the old table, so the migration cannot run twice", async () => {
    legacyDatabase([["Mage", "Fire", "Scorch to five."]]);
    const repo = getSqliteRepo();
    expect(await repo.listGuides()).toHaveLength(1);

    const tables = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'class_guides'")
      .all();
    expect(tables).toEqual([]);
  });

  it("costs nothing on a database that never had the old table", async () => {
    // The overwhelmingly common case, and it must not throw.
    const repo = getSqliteRepo();
    expect(await repo.listGuides()).toEqual([]);
  });
});
