import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  countAppAdmins,
  createAuthSession,
  findAuthSession,
  getDb,
  hashToken,
  listAccounts,
  revokeAccountSessions,
  setAccountAppAdmin,
  setAccountDisabled,
  upsertAccount,
} from "@/lib/data/db";
import { getSqliteRepo } from "@/lib/data/sqlite-repo";

beforeEach(() => {
  process.env.PROJECTLC_DB = path.join(mkdtempSync(path.join(tmpdir(), "projectlc-tenancy-")), "test.db");
});

const NOW = "2026-08-12T10:00:00.000Z";
const LATER = "2027-08-12T10:00:00.000Z";

function account(db: ReturnType<typeof getDb>, id: string, admin = false) {
  getSqliteRepo();
  const person = upsertAccount(db, { discordId: id, discordUsername: id, now: NOW });
  if (admin) setAccountAppAdmin(db, person.id, true);
  return person.id;
}

function session(db: ReturnType<typeof getDb>, accountId: string, token: string) {
  createAuthSession(db, { tokenHash: hashToken(token), accountId, createdAt: NOW, expiresAt: LATER });
  return token;
}

describe("the accounts an operator administers", () => {
  it("reports live sessions and a guild count, and nothing about what they hold", async () => {
    // Deliberately a count. Which roles somebody has inside a guild is that
    // guild's business, and an operator page that showed it would be the §7
    // boundary eroding through the diagnostics door.
    const db = getDb();
    const id = account(db, "katze");
    session(db, id, "live-one");
    session(db, id, "live-two");

    const [row] = listAccounts(db);
    expect(row).toMatchObject({ discordUsername: "katze", liveSessions: 2, guildCount: 0 });
    expect(Object.keys(row).sort()).toEqual(
      ["appAdmin", "createdAt", "disabled", "discordUsername", "guildCount", "id", "lastSeenAt", "liveSessions"].sort(),
    );
  });

  it("ends every session when an account is disabled", async () => {
    // Without this, disabling does nothing until the cookie happens to expire —
    // which is exactly the window you are trying to close.
    const db = getDb();
    const id = account(db, "katze");
    const token = session(db, id, "still-good");
    expect(findAuthSession(db, hashToken(token))?.revokedAt).toBeUndefined();

    setAccountDisabled(db, id, true);
    expect(findAuthSession(db, hashToken(token))?.revokedAt).toBeTruthy();
  });

  it("kicks a leaked cookie without disabling the person", async () => {
    const db = getDb();
    const id = account(db, "katze");
    session(db, id, "leaked");

    expect(revokeAccountSessions(db, id)).toBe(1);
    expect(listAccounts(db)[0]).toMatchObject({ liveSessions: 0, disabled: false });
  });
});

describe("the last operator", () => {
  it("is countable, which is what the guards are built on", async () => {
    const db = getDb();
    account(db, "katze", true);
    expect(countAppAdmins(db)).toBe(1);
    account(db, "second", true);
    expect(countAppAdmins(db)).toBe(2);
  });

  it("does not count once disabled, because they cannot sign in to use it", async () => {
    // The guard has to key on operators who could actually reach the console.
    // Counting a disabled one would let the last usable operator remove their
    // own flag while the count still read two.
    const db = getDb();
    const first = account(db, "katze", true);
    account(db, "second", true);
    setAccountDisabled(db, first, true);
    expect(countAppAdmins(db)).toBe(1);
  });
});
