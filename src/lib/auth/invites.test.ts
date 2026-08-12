import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  findInviteByCodeHash,
  findMembershipByAccount,
  getCharacterMembershipId,
  getDataVersion,
  getDb,
  hashToken,
  insertGuildInvite,
  insertGuildRole,
  insertMembership,
  loadStore,
  purgeExpiredInvites,
  setCharacterMembership,
  upsertAccount,
} from "@/lib/data/db";
import { getSqliteRepo } from "@/lib/data/sqlite-repo";
import {
  checkInvite,
  formatInviteCode,
  INVITE_TTL_DAYS,
  issueInvite,
  newInviteCode,
  normalizeInviteCode,
  redeemInvite,
  revokeInvite,
} from "@/lib/auth/invites";

beforeEach(() => {
  process.env.PROJECTLC_DB = path.join(mkdtempSync(path.join(tmpdir(), "projectlc-inv-")), "test.db");
});

const NOW = "2026-08-11T10:00:00.000Z";
const later = (days: number) => new Date(Date.parse(NOW) + days * 86400000).toISOString();

/** Boot the seeded database and hand back two roster characters and the guild. */
async function guild() {
  const repo = getSqliteRepo();
  const db = getDb();
  const store = loadStore(db);
  const roster = await repo.listCharacters();
  return { db, guildId: store.guild.id, main: roster[0].character.id, alt: roster[1].character.id };
}

function officer(db: ReturnType<typeof getDb>, guildId: string) {
  const person = upsertAccount(db, { discordId: "gm", discordUsername: "Katze", now: NOW });
  insertMembership(db, {
    id: "mem_gm", guildId, accountId: person.id, displayName: "Katze",
    isGuildMaster: true, roleIds: [], joinedAt: NOW,
  });
  return "mem_gm";
}

function newcomer(db: ReturnType<typeof getDb>, discordId = "newbie") {
  return upsertAccount(db, { discordId, discordUsername: "Thrainn", now: NOW }).id;
}

function role(db: ReturnType<typeof getDb>, guildId: string, id: string, caps: string[]) {
  insertGuildRole(db, { id, guildId, name: id, sort: 0, capabilities: caps, baseline: false });
  return id;
}

function issue(guildId: string, characterId: string, over: Record<string, unknown> = {}) {
  const result = issueInvite({ guildId, characterId, createdBy: "mem_gm", actor: "Katze", now: NOW, ...over });
  if (!result.ok) throw new Error(`issue refused: ${result.reason}`);
  return result.issued;
}

describe("the code itself", () => {
  it("never leaves the plaintext anywhere in the database", async () => {
    const { db, guildId, main } = await guild();
    officer(db, guildId);
    const { code } = issue(guildId, main);

    const dump = JSON.stringify(db.prepare("SELECT * FROM guild_invites").all());
    expect(dump).not.toContain(code);
    expect(dump).not.toContain(normalizeInviteCode(code));
    expect(dump).toContain(hashToken(normalizeInviteCode(code)!));
  });

  it("survives being retyped by a human", () => {
    // These codes get read off Discord and typed back in. Every one of these is
    // the same code; a system that rejected any of them would be blamed on the
    // officer who "sent a broken invite".
    const canonical = normalizeInviteCode("ABCD-2345-6789-JKMN")!;
    for (const variant of [
      "abcd-2345-6789-jkmn",
      "ABCD2345 6789 JKMN",
      "  ABCD-2345-6789-JKMN  ",
      "ABCD-2345-6789-JKMN",
    ]) {
      expect(normalizeInviteCode(variant)).toBe(canonical);
    }
  });

  it("folds the glyphs people cannot tell apart", () => {
    // O/0 and I/L/1 are the whole reason for Crockford's alphabet.
    expect(normalizeInviteCode("OOOO-IIII-LLLL-1111")).toBe("0000111111111111");
  });

  it("refuses anything that is not the shape we issue", () => {
    expect(normalizeInviteCode("")).toBeNull();
    expect(normalizeInviteCode(null)).toBeNull();
    expect(normalizeInviteCode("too-short")).toBeNull();
    expect(normalizeInviteCode("ABCD-2345-6789-JKMN-EXTRA")).toBeNull();
    // U is deliberately not in the alphabet, so it cannot be a typo we accept.
    expect(normalizeInviteCode("UUUU-2345-6789-JKMN")).toBeNull();
  });

  it("only ever emits symbols it can read back", () => {
    for (let i = 0; i < 200; i++) {
      const code = newInviteCode();
      expect(code).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);
      expect(normalizeInviteCode(code)).toBe(code.replace(/-/g, ""));
    }
  });

  it("does not repeat itself", () => {
    const seen = new Set(Array.from({ length: 500 }, () => newInviteCode()));
    expect(seen.size).toBe(500);
  });

  it("groups a canonical code for reading", () => {
    expect(formatInviteCode("ABCD23456789JKMN")).toBe("ABCD-2345-6789-JKMN");
  });
});

describe("issuing", () => {
  it("binds the invite to a roster character and dates it", async () => {
    const { db, guildId, main } = await guild();
    officer(db, guildId);
    const { invite } = issue(guildId, main);

    expect(invite.characterId).toBe(main);
    expect(invite.guildId).toBe(guildId);
    expect(invite.expiresAt).toBe(later(INVITE_TTL_DAYS));
    expect(invite.redeemedAt).toBeUndefined();
  });

  it("refuses a character that is not in this guild", async () => {
    const { db, guildId, main } = await guild();
    officer(db, guildId);
    expect(issueInvite({ guildId: "some-other-guild", characterId: main, createdBy: "mem_gm", actor: "Katze", now: NOW }))
      .toEqual({ ok: false, reason: "character-missing" });
    expect(issueInvite({ guildId, characterId: "no-such-character", createdBy: "mem_gm", actor: "Katze", now: NOW }))
      .toEqual({ ok: false, reason: "character-missing" });
  });

  it("refuses a character somebody already plays", async () => {
    // They do not need an invite, they need to sign in. Saying so at issue time
    // is far kinder than at redemption, where the holder can do nothing about it.
    const { db, guildId, main } = await guild();
    officer(db, guildId);
    redeemInvite({ code: issue(guildId, main).code, accountId: newcomer(db), displayName: "Thrainn", now: NOW });

    expect(issueInvite({ guildId, characterId: main, createdBy: "mem_gm", actor: "Katze", now: NOW }))
      .toEqual({ ok: false, reason: "character-taken" });
  });

  it("supersedes an unredeemed invite for the same character", async () => {
    // "Send it again" is the common case. Leaving the old code live would mean
    // every resend adds a working key to the guild nobody remembers handing out.
    const { db, guildId, main } = await guild();
    officer(db, guildId);
    const first = issue(guildId, main);
    const second = issue(guildId, main);

    expect(checkInvite(first.code, NOW)).toEqual({ ok: false, reason: "unknown" });
    expect(checkInvite(second.code, NOW).ok).toBe(true);
    expect(db.prepare("SELECT COUNT(*) AS n FROM guild_invites").get()).toEqual({ n: 1 });
  });

  it("drops roles that no longer exist rather than granting a dangling id", async () => {
    const { db, guildId, main } = await guild();
    officer(db, guildId);
    role(db, guildId, "role_raider", ["loot.view"]);
    const { invite } = issue(guildId, main, { roleIds: ["role_raider", "role_deleted_last_week"] });
    expect(invite.roleIds).toEqual(["role_raider"]);
  });

  it("writes an audit line and bumps the version", async () => {
    const { db, guildId, main } = await guild();
    officer(db, guildId);
    const before = getDataVersion(db);
    issue(guildId, main);

    expect(getDataVersion(db)).toBeGreaterThan(before);
    const audit = loadStore(db).guildAudit.find((a) => a.kind === "invite.issued");
    expect(audit?.actor).toBe("Katze");
  });
});

describe("redeeming", () => {
  it("makes a member and claims the character in one act", async () => {
    const { db, guildId, main } = await guild();
    officer(db, guildId);
    const raider = role(db, guildId, "role_raider", ["loot.view"]);
    const { code } = issue(guildId, main, { roleIds: [raider] });
    const accountId = newcomer(db);

    const result = redeemInvite({ code, accountId, displayName: "Thrainn", now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.redeemed.joined).toBe(true);

    const membership = findMembershipByAccount(db, guildId, accountId);
    expect(membership?.roleIds).toEqual([raider]);
    // Ownership never travels on an invite.
    expect(membership?.isGuildMaster).toBe(false);
    expect(getCharacterMembershipId(db, main)).toBe(membership?.id);
  });

  it("accepts the code exactly as a person would paste it back", async () => {
    const { db, guildId, main } = await guild();
    officer(db, guildId);
    const { code } = issue(guildId, main);
    const typed = ` ${code.toLowerCase().replace(/-/g, " ")} `;

    expect(redeemInvite({ code: typed, accountId: newcomer(db), displayName: "Thrainn", now: NOW }).ok).toBe(true);
  });

  it("works exactly once", async () => {
    const { db, guildId, main } = await guild();
    officer(db, guildId);
    const { code } = issue(guildId, main);

    expect(redeemInvite({ code, accountId: newcomer(db, "a"), displayName: "A", now: NOW }).ok).toBe(true);
    expect(redeemInvite({ code, accountId: newcomer(db, "b"), displayName: "B", now: NOW }))
      .toEqual({ ok: false, reason: "used" });
    // And the loser is not left half-joined.
    expect(findMembershipByAccount(db, guildId, newcomer(db, "b"))).toBeUndefined();
  });

  it("stops working after its deadline", async () => {
    const { db, guildId, main } = await guild();
    officer(db, guildId);
    const { code } = issue(guildId, main);

    expect(checkInvite(code, later(INVITE_TTL_DAYS - 1)).ok).toBe(true);
    expect(redeemInvite({ code, accountId: newcomer(db), displayName: "T", now: later(INVITE_TTL_DAYS + 1) }))
      .toEqual({ ok: false, reason: "expired" });
    expect(getCharacterMembershipId(db, main)).toBeNull();
  });

  it("refuses a code nobody issued without saying more", async () => {
    await guild();
    expect(redeemInvite({ code: "ABCD-2345-6789-JKMN", accountId: "acc_x", displayName: "X", now: NOW }))
      .toEqual({ ok: false, reason: "unknown" });
    expect(redeemInvite({ code: "nonsense", accountId: "acc_x", displayName: "X", now: NOW }))
      .toEqual({ ok: false, reason: "malformed" });
  });

  it("never takes a character off somebody else", async () => {
    // A wrong claim misattributes years of wishlists and awards. The invite is
    // recoverable; the attribution is not.
    //
    // Written through the raw writer on purpose: issueInvite refuses a claimed
    // character, so the only way to reach this is a code that was already in
    // flight when somebody else claimed — which is exactly the race worth
    // covering, and the one an officer cannot see coming.
    const { db, guildId, main } = await guild();
    officer(db, guildId);
    const inFlight = "ABCD-2345-6789-JKMN";
    insertGuildInvite(db, {
      id: "inv_stale", guildId, characterId: main, codeHash: hashToken(normalizeInviteCode(inFlight)!),
      roleIds: [], createdBy: "mem_gm", createdAt: NOW, expiresAt: later(INVITE_TTL_DAYS),
    });
    // The officer links that character to themselves in the meantime — the same
    // act as linking your own character, which does not go through issueInvite
    // and so does not supersede anything.
    setCharacterMembership(db, main, "mem_gm");
    const owner = getCharacterMembershipId(db, main);

    expect(redeemInvite({ code: inFlight, accountId: newcomer(db, "second"), displayName: "Second", now: NOW }))
      .toEqual({ ok: false, reason: "character-taken" });
    expect(getCharacterMembershipId(db, main)).toBe(owner);
    // And the loser did not become a member on the way to being refused.
    expect(findMembershipByAccount(db, guildId, newcomer(db, "second"))).toBeUndefined();
  });
});

describe("an account that is already a member", () => {
  // The alt case, and the reason redemption reuses a membership: a raider with
  // a main and two alts is one person, one membership, three claimed characters.
  async function joined() {
    const { db, guildId, main, alt } = await guild();
    officer(db, guildId);
    const accountId = newcomer(db);
    redeemInvite({ code: issue(guildId, main).code, accountId, displayName: "Thrainn", now: NOW });
    return { db, guildId, main, alt, accountId, membershipId: findMembershipByAccount(db, guildId, accountId)!.id };
  }

  it("claims the alt onto the membership they already have", async () => {
    const { db, guildId, alt, accountId, membershipId } = await joined();
    const result = redeemInvite({ code: issue(guildId, alt).code, accountId, displayName: "Thrainn", now: NOW });

    expect(result.ok && result.redeemed.joined).toBe(false);
    expect(getCharacterMembershipId(db, alt)).toBe(membershipId);
    const rows = db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE account_id = ?").get(accountId);
    expect(rows).toEqual({ n: 1 });
  });

  it("adds the invite's roles and never replaces them", async () => {
    // A routine "here is your alt" invite must not quietly demote an officer.
    const { db, guildId, alt, accountId, membershipId } = await joined();
    const raider = role(db, guildId, "role_raider", ["loot.view"]);
    const officerRole = role(db, guildId, "role_officer", ["loot.award"]);
    db.prepare("UPDATE memberships SET role_ids_json = ? WHERE id = ?").run(JSON.stringify([officerRole]), membershipId);

    redeemInvite({ code: issue(guildId, alt, { roleIds: [raider] }).code, accountId, displayName: "Thrainn", now: NOW });

    expect(findMembershipByAccount(db, guildId, accountId)?.roleIds.sort()).toEqual([officerRole, raider].sort());
  });

  it("records the two cases differently, because they are different events", async () => {
    const { db, guildId, alt, accountId } = await joined();
    redeemInvite({ code: issue(guildId, alt).code, accountId, displayName: "Thrainn", now: NOW });

    const kinds = loadStore(db).guildAudit.map((a) => a.kind);
    expect(kinds).toContain("invite.joined");
    expect(kinds).toContain("invite.linked");
  });
});

describe("revoking", () => {
  it("takes an unused invite back", async () => {
    const { db, guildId, main } = await guild();
    officer(db, guildId);
    const { invite, code } = issue(guildId, main);

    expect(revokeInvite({ inviteId: invite.id, guildId, actor: "Katze", now: NOW })).toBe(true);
    expect(checkInvite(code, NOW)).toEqual({ ok: false, reason: "unknown" });
    expect(loadStore(db).guildAudit.some((a) => a.kind === "invite.revoked")).toBe(true);
  });

  it("will not erase how somebody got in", async () => {
    // Removing a member is deleteMembership's job. Deleting a redeemed invite
    // would only destroy the record of who let them in (invariant 6).
    const { db, guildId, main } = await guild();
    officer(db, guildId);
    const { invite, code } = issue(guildId, main);
    redeemInvite({ code, accountId: newcomer(db), displayName: "Thrainn", now: NOW });

    expect(revokeInvite({ inviteId: invite.id, guildId, actor: "Katze", now: NOW })).toBe(false);
    expect(findInviteByCodeHash(db, invite.codeHash)?.redeemedAt).toBe(NOW);
  });

  it("cannot reach into another guild", async () => {
    const { db, guildId, main } = await guild();
    officer(db, guildId);
    const { invite } = issue(guildId, main);
    expect(revokeInvite({ inviteId: invite.id, guildId: "elsewhere", actor: "X", now: NOW })).toBe(false);
  });
});

describe("housekeeping", () => {
  it("clears out expired invites but keeps the redeemed ones as history", async () => {
    const { db, guildId, main, alt } = await guild();
    officer(db, guildId);
    redeemInvite({ code: issue(guildId, main).code, accountId: newcomer(db), displayName: "T", now: NOW });
    issue(guildId, alt);

    expect(purgeExpiredInvites(db, later(INVITE_TTL_DAYS + 1))).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM guild_invites").get()).toEqual({ n: 1 });
    expect(loadStore(db).guildInvites[0].redeemedAt).toBe(NOW);
  });
});
