import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  BREAK_GLASS_MAX_MINUTES,
  closeBreakGlass,
  findOpenBreakGlass,
  getDb,
  loadStore,
  openBreakGlass,
  upsertAccount,
} from "@/lib/data/db";
import { getSqliteRepo } from "@/lib/data/sqlite-repo";
import { appAdminViewer } from "@/lib/auth/viewer";
import { decide, requireCapability } from "@/lib/auth/can";

beforeEach(() => {
  process.env.PROJECTLC_DB = path.join(mkdtempSync(path.join(tmpdir(), "projectlc-bg-")), "test.db");
});

const NOW = "2026-08-12T10:00:00.000Z";

function setup() {
  getSqliteRepo();
  const db = getDb();
  const operator = upsertAccount(db, { discordId: "op", discordUsername: "Operator", now: NOW });
  return { db, guildId: loadStore(db).guild.id, operator: operator.id };
}

const glassFor = (g: { guildId: string; reason: string; expiresAt: string }) => g;

describe("an operator with no override", () => {
  it("holds nothing at all inside a guild", () => {
    // §7. The flag opens the service console and nothing else.
    const viewer = appAdminViewer("acc_op", null);
    expect(decide(viewer, "roster.view").allowed).toBe(false);
    expect(decide(viewer, "loot.award").allowed).toBe(false);
    expect(decide(viewer, "guild.edit").allowed).toBe(false);
  });
});

describe("break-glass", () => {
  it("grants inside the named guild, and nowhere else", () => {
    const { db, guildId, operator } = setup();
    const glass = openBreakGlass(db, { guildId, accountId: operator, reason: "Realm transfer support ticket 41", minutes: 30, now: NOW });
    const viewer = appAdminViewer(operator, glassFor(glass));

    expect(decide(viewer, "guild.edit", { guildId, now: new Date(NOW) }).allowed).toBe(true);
    // Scoped: an override for one guild is nothing in another.
    expect(decide(viewer, "guild.edit", { guildId: "another-guild", now: new Date(NOW) }).allowed).toBe(false);
  });

  it("stops working on its own, with nobody closing it", () => {
    // Expiry is in the query and in decide(), so a forgotten override is not a
    // permanent one — there is no state somebody has to remember to clean up.
    const { db, guildId, operator } = setup();
    const glass = openBreakGlass(db, { guildId, accountId: operator, reason: "Ticket 41 diagnosis", minutes: 30, now: NOW });
    const viewer = appAdminViewer(operator, glassFor(glass));
    const later = new Date(Date.parse(NOW) + 31 * 60_000);

    expect(decide(viewer, "guild.edit", { guildId, now: later }).allowed).toBe(false);
    expect(findOpenBreakGlass(db, operator, guildId, later.toISOString())).toBeUndefined();
  });

  it("cannot be opened for longer than the cap, however it is asked for", () => {
    const { db, guildId, operator } = setup();
    const glass = openBreakGlass(db, { guildId, accountId: operator, reason: "x", minutes: 60 * 24 * 30, now: NOW });
    const minutes = (Date.parse(glass.expiresAt) - Date.parse(NOW)) / 60_000;
    expect(minutes).toBe(BREAK_GLASS_MAX_MINUTES);
  });

  it("announces itself on the decision, so the audit write cannot be skipped", () => {
    // decide() sets `audit` only on this path. requireCapability writes it —
    // no call site has to remember, which is why it happens at all.
    const { db, guildId, operator } = setup();
    const glass = openBreakGlass(db, { guildId, accountId: operator, reason: "Ticket 41", minutes: 30, now: NOW });
    const viewer = appAdminViewer(operator, glassFor(glass));

    const asMember = decide(viewer, "guild.edit", { guildId, now: new Date(NOW) });
    expect(asMember.via).toBe("break-glass");
    expect(asMember.audit).toBeTruthy();
    // An ordinary grant carries no audit, so the log is only ever the overrides.
    expect(decide(appAdminViewer("x", null), "guild.edit").audit).toBeNull();
  });

  it("writes into the guild's own log when it is used", async () => {
    const { db, guildId, operator } = setup();
    const glass = openBreakGlass(db, { guildId, accountId: operator, reason: "Ticket 41", minutes: 30, now: NOW });
    const viewer = appAdminViewer(operator, glassFor(glass));

    requireCapability(viewer, "guild.edit", { guildId, now: new Date(NOW) });
    // The write is fire-and-forget so an audit failure cannot fail the action.
    await new Promise((r) => setTimeout(r, 50));

    const entry = loadStore(db).guildAudit.find((a) => a.kind === "break-glass.used");
    expect(entry?.reason).toBe("Ticket 41");
    expect(entry?.detail).toContain("guild.edit");
  });

  it("can be closed early, and is gone immediately", () => {
    const { db, guildId, operator } = setup();
    const glass = openBreakGlass(db, { guildId, accountId: operator, reason: "Ticket 41", minutes: 30, now: NOW });
    expect(closeBreakGlass(db, glass.id)).toBe(true);
    expect(findOpenBreakGlass(db, operator, guildId, NOW)).toBeUndefined();
    // Closing twice is not an error, it is just nothing.
    expect(closeBreakGlass(db, glass.id)).toBe(false);
  });
});
