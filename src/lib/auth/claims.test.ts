import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getCharacterMembershipId,
  touchAccountSeen,
  getDataVersion,
  getDb,
  insertMembership,
  loadStore,
  upsertAccount,
} from "@/lib/data/db";
import { getSqliteRepo } from "@/lib/data/sqlite-repo";
import { linkCharacter, unlinkCharacter } from "@/lib/auth/claims";
import { addGuildOwner, deleteMembership, removeGuildOwner } from "@/lib/data/db";

beforeEach(() => {
  process.env.PROJECTLC_DB = path.join(mkdtempSync(path.join(tmpdir(), "projectlc-claims-")), "test.db");
});

const NOW = "2026-08-12T10:00:00.000Z";

async function guild() {
  const repo = getSqliteRepo();
  const db = getDb();
  const store = loadStore(db);
  const roster = await repo.listCharacters();
  return { db, guildId: store.guild.id, main: roster[0].character.id, alt: roster[1].character.id };
}

function member(db: ReturnType<typeof getDb>, guildId: string, id: string, name: string) {
  const person = upsertAccount(db, { discordId: id, discordUsername: name, now: NOW });
  insertMembership(db, {
    id, guildId, accountId: person.id, displayName: name, isGuildMaster: false, roleIds: [], joinedAt: NOW,
  });
  return id;
}

describe("linking a character to a member", () => {
  it("says who plays what, and writes it down", async () => {
    const { db, guildId, main } = await guild();
    member(db, guildId, "mem_1", "Katze");
    const before = getDataVersion(db);

    expect(linkCharacter({ guildId, characterId: main, membershipId: "mem_1", actor: "Katze", now: NOW })).toEqual({ ok: true });
    expect(getCharacterMembershipId(db, main)).toBe("mem_1");
    expect(getDataVersion(db)).toBeGreaterThan(before);
  });

  it("names the character in the audit line, not its id", async () => {
    // An audit entry reading "linked chr_f31b8934… " records that something
    // happened and not what. The log exists to be read by officers.
    const { db, guildId, main } = await guild();
    member(db, guildId, "mem_1", "Katze");
    const name = loadStore(db).roster.find((c) => c.id === main)!.name;

    linkCharacter({ guildId, characterId: main, membershipId: "mem_1", actor: "Katze", now: NOW });
    const entry = loadStore(db).guildAudit.find((a) => a.kind === "character.linked");
    expect(entry?.detail).toContain(name);
    expect(entry?.detail).not.toContain(main);
  });

  it("refuses to move a character somebody already holds", async () => {
    // One step would let a mis-click move a raider's whole loot history onto
    // another person, with nothing in the log saying it happened.
    const { db, guildId, main } = await guild();
    member(db, guildId, "mem_1", "Katze");
    member(db, guildId, "mem_2", "Thrainn");
    linkCharacter({ guildId, characterId: main, membershipId: "mem_1", actor: "Katze", now: NOW });

    expect(linkCharacter({ guildId, characterId: main, membershipId: "mem_2", actor: "Katze", now: NOW }))
      .toEqual({ ok: false, reason: "already-claimed" });
    expect(getCharacterMembershipId(db, main)).toBe("mem_1");
  });

  it("is idempotent for the member who already holds it", async () => {
    const { db, guildId, main } = await guild();
    member(db, guildId, "mem_1", "Katze");
    linkCharacter({ guildId, characterId: main, membershipId: "mem_1", actor: "Katze", now: NOW });

    expect(linkCharacter({ guildId, characterId: main, membershipId: "mem_1", actor: "Katze", now: NOW })).toEqual({ ok: true });
    // No second audit line: nothing happened the second time.
    expect(loadStore(db).guildAudit.filter((a) => a.kind === "character.linked")).toHaveLength(1);
  });

  it("refuses a character or a member from another guild", async () => {
    const { db, guildId, main } = await guild();
    member(db, guildId, "mem_1", "Katze");

    expect(linkCharacter({ guildId, characterId: "nope", membershipId: "mem_1", actor: "K", now: NOW }))
      .toEqual({ ok: false, reason: "character-missing" });
    expect(linkCharacter({ guildId, characterId: main, membershipId: "mem_elsewhere", actor: "K", now: NOW }))
      .toEqual({ ok: false, reason: "membership-missing" });
    expect(linkCharacter({ guildId: "other-guild", characterId: main, membershipId: "mem_1", actor: "K", now: NOW }))
      .toEqual({ ok: false, reason: "character-missing" });
  });

  it("lets one person hold several characters", async () => {
    // The alt case. One membership, many characters — never the reverse.
    const { db, guildId, main, alt } = await guild();
    member(db, guildId, "mem_1", "Katze");
    linkCharacter({ guildId, characterId: main, membershipId: "mem_1", actor: "Katze", now: NOW });
    linkCharacter({ guildId, characterId: alt, membershipId: "mem_1", actor: "Katze", now: NOW });

    expect(getCharacterMembershipId(db, main)).toBe("mem_1");
    expect(getCharacterMembershipId(db, alt)).toBe("mem_1");
  });
});

describe("unlinking", () => {
  it("hands the character back without touching it", async () => {
    // History is unlinked, never destroyed (invariant 6).
    const { db, guildId, main } = await guild();
    member(db, guildId, "mem_1", "Katze");
    linkCharacter({ guildId, characterId: main, membershipId: "mem_1", actor: "Katze", now: NOW });
    const character = loadStore(db).roster.find((c) => c.id === main);

    expect(unlinkCharacter({ guildId, characterId: main, actor: "Katze", now: NOW })).toEqual({ ok: true });
    expect(getCharacterMembershipId(db, main)).toBeNull();
    const after = loadStore(db).roster.find((c) => c.id === main);
    expect({ ...after, membershipId: null }).toEqual({ ...character, membershipId: null });
  });

  it("records who it came from, so the pair of decisions reads as two", async () => {
    const { db, guildId, main } = await guild();
    member(db, guildId, "mem_1", "Katze");
    linkCharacter({ guildId, characterId: main, membershipId: "mem_1", actor: "Katze", now: NOW });
    unlinkCharacter({ guildId, characterId: main, actor: "Officer", now: NOW });

    const kinds = loadStore(db).guildAudit.map((a) => a.kind);
    expect(kinds).toContain("character.linked");
    expect(kinds).toContain("character.unlinked");
    expect(loadStore(db).guildAudit.find((a) => a.kind === "character.unlinked")?.detail).toContain("Katze");
  });

  it("says so when there was nothing to unlink", async () => {
    const { guildId, main } = await guild();
    expect(unlinkCharacter({ guildId, characterId: main, actor: "K", now: NOW }))
      .toEqual({ ok: false, reason: "not-claimed" });
  });
});

describe("removing a member", () => {
  it("unlinks their characters and destroys nothing", async () => {
    // Invariant 6. The awards stay, the attendance stays, the history stays —
    // what goes is the claim saying which account speaks for the character.
    const { db, guildId, main } = await guild();
    member(db, guildId, "mem_1", "Thrainn");
    linkCharacter({ guildId, characterId: main, membershipId: "mem_1", actor: "K", now: NOW });
    const awardsBefore = loadStore(db).lootAwards.length;

    const result = deleteMembership(db, "mem_1");
    expect(result).toEqual({ ok: true, unlinkedCharacters: 1 });
    expect(getCharacterMembershipId(db, main)).toBeNull();
    expect(loadStore(db).roster.find((c) => c.id === main)).toBeTruthy();
    expect(loadStore(db).lootAwards).toHaveLength(awardsBefore);
  });

  it("refuses an owner, and says to demote them first", async () => {
    // Ownership rules cannot be enforced from here, so this does not try.
    const { db, guildId } = await guild();
    member(db, guildId, "mem_gm", "Katze");
    addGuildOwner(db, guildId, "mem_gm", { name: "system" });

    const result = deleteMembership(db, "mem_gm");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Remove their ownership first");
  });
});

describe("ownership, once there is more than one owner", () => {
  it("never leaves a guild without one", async () => {
    // The single state a guild can enter and never leave.
    const { db, guildId } = await guild();
    member(db, guildId, "mem_gm", "Katze");
    addGuildOwner(db, guildId, "mem_gm", { name: "system" });

    const result = removeGuildOwner(db, guildId, "mem_gm", { membershipId: "mem_gm", name: "Katze" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("without an owner");
  });

  it("lets an owner step down, but not push out an active co-owner", async () => {
    // Otherwise co-ownership is a race to remove the other person first.
    const { db, guildId } = await guild();
    member(db, guildId, "mem_a", "A");
    member(db, guildId, "mem_b", "B");
    addGuildOwner(db, guildId, "mem_a", { name: "system" });
    addGuildOwner(db, guildId, "mem_b", { name: "system" });
    touchAccountSeen(db, loadStore(db).memberships.find((m) => m.id === "mem_b")!.accountId, NOW_ISO());

    expect(removeGuildOwner(db, guildId, "mem_b", { membershipId: "mem_a", name: "A" }).ok).toBe(false);
    // Stepping down is always allowed.
    expect(removeGuildOwner(db, guildId, "mem_b", { membershipId: "mem_b", name: "B" }).ok).toBe(true);
  });
});

function NOW_ISO() {
  return new Date().toISOString();
}
