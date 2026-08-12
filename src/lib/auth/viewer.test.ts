import { afterEach, describe, expect, it } from "vitest";
import { authEnabled, memberViewer, resolveViewer } from "./viewer";
import { can } from "./can";
import { CAPABILITY_IDS } from "./capabilities";

const original = process.env.PROJECTLC_AUTH;
afterEach(() => {
  if (original === undefined) delete process.env.PROJECTLC_AUTH;
  else process.env.PROJECTLC_AUTH = original;
});

describe("authEnabled", () => {
  it("is off unless switched on deliberately", () => {
    delete process.env.PROJECTLC_AUTH;
    expect(authEnabled()).toBe(false);
    // Not "any truthy value": a deployment that sets PROJECTLC_AUTH=false or
    // =0 meaning "off" must not silently get a locked app.
    for (const value of ["", "false", "0", "off", "yes", "1", "true"]) {
      process.env.PROJECTLC_AUTH = value;
      expect(authEnabled(), value).toBe(false);
    }
    process.env.PROJECTLC_AUTH = "on";
    expect(authEnabled()).toBe(true);
  });
});

describe("resolveViewer", () => {
  it("is unrestricted while auth is off, so nothing changes before step 3", async () => {
    delete process.env.PROJECTLC_AUTH;
    const viewer = await resolveViewer();
    expect(viewer.unrestricted).toBe(true);
    for (const id of CAPABILITY_IDS) expect(can(viewer, id), id).toBe(true);
  });

  it("locks down rather than breaking when auth is on before sessions exist", async () => {
    process.env.PROJECTLC_AUTH = "on";
    const viewer = await resolveViewer();
    expect(viewer.unrestricted).toBe(false);
    expect(viewer.accountId).toBeNull();
    for (const id of CAPABILITY_IDS) expect(can(viewer, id), id).toBe(false);
  });
});

describe("memberViewer", () => {
  it("expands implications once, at construction", () => {
    const viewer = memberViewer({
      accountId: "a1",
      guildId: "g1",
      membershipId: "m1",
      capabilities: ["loot.award"],
    });
    expect([...(viewer.guild?.capabilities ?? [])].sort()).toEqual([
      "loot.award",
      "loot.view",
      "roster.view",
    ]);
  });

  it("drops unknown stored grants instead of carrying them", () => {
    const viewer = memberViewer({
      accountId: "a1",
      guildId: "g1",
      membershipId: "m1",
      capabilities: ["loot.view", "loot.somethingRetired"],
    });
    expect([...(viewer.guild?.capabilities ?? [])]).toEqual(["loot.view"]);
  });

  it("is not an app admin and holds no break-glass unless told", () => {
    const viewer = memberViewer({ accountId: "a1", guildId: "g1", membershipId: "m1" });
    expect(viewer.appAdmin).toBe(false);
    expect(viewer.breakGlass).toBeNull();
    expect(viewer.unrestricted).toBe(false);
  });
});
