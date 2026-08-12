import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPublicProfile,
  DEFAULT_VISIBILITY,
  isGuildVisibility,
  type GuildVisibility,
  type PublicProfileInput,
} from "./public-profile";

const input = (visibility: GuildVisibility, over: Partial<PublicProfileInput> = {}): PublicProfileInput => ({
  guild: { name: "Oilers", realm: "Spineshatter", faction: "Horde", activePhase: 3 },
  roster: [
    { name: "Zul", wowClass: "Shaman", spec: "Restoration", role: "Healer" },
    { name: "Aandor", wowClass: "Warrior", spec: "Fury", role: "Melee DPS" },
  ],
  raidNights: [
    { date: "2026-08-01", zones: ["Serpentshrine Cavern"] },
    { date: "2026-08-08", zones: ["Tempest Keep"] },
  ],
  visibility,
  ...over,
});

describe("what a stranger sees", () => {
  it("always knows the guild exists and who it is", () => {
    // A page that publishes literally nothing is a 404 with extra steps, and an
    // invite link would land somewhere unrecognisable.
    const p = buildPublicProfile(input("private"));
    expect(p).toMatchObject({ name: "Oilers", realm: "Spineshatter", faction: "Horde" });
  });

  it("shows nothing else on Private", () => {
    const p = buildPublicProfile(input("private"));
    expect(p.roster).toBeNull();
    expect(p.rosterSize).toBeNull();
    expect(p.raidNights).toBeNull();
    expect(p.activePhase).toBeNull();
  });

  it("adds the roster and the tier on Recruiting", () => {
    const p = buildPublicProfile(input("recruiting"));
    expect(p.roster?.map((c) => c.name)).toEqual(["Aandor", "Zul"]);
    expect(p.rosterSize).toBe(2);
    expect(p.activePhase).toBe(3);
    // Raid history is the next step up, not this one.
    expect(p.raidNights).toBeNull();
  });

  it("adds raid nights on Open, newest first", () => {
    const p = buildPublicProfile(input("open"));
    expect(p.raidNights?.map((n) => n.date)).toEqual(["2026-08-08", "2026-08-01"]);
    // Cumulative: moving up a preset never takes away what was already shown.
    expect(p.roster).not.toBeNull();
    expect(p.activePhase).toBe(3);
  });

  it("tells 'we don't publish that' apart from 'there is none'", () => {
    // A guild with no logged raids and a guild keeping them to itself must not
    // read the same to a stranger, or the page implies something false.
    expect(buildPublicProfile(input("recruiting")).raidNights).toBeNull();
    expect(buildPublicProfile(input("open", { raidNights: [] })).raidNights).toEqual([]);
  });

  it("does not publish a year of raid history", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      date: `2026-0${1 + (i % 9)}-0${1 + (i % 9)}`,
      zones: ["Karazhan"],
    }));
    expect(buildPublicProfile(input("open", { raidNights: many })).raidNights).toHaveLength(12);
  });
});

describe("what a stranger can never see", () => {
  it("has no way to receive the council's judgements at all", () => {
    /*
     * The real guarantee is the input type, not a filter — so this asserts on
     * the source. `buildPublicProfile` cannot leak an award, a standing or an
     * attendance figure because it is never handed one, and a `status` field
     * would leak "who is on trial" while sitting on the same row as the name.
     *
     * If this fails, somebody widened the public surface. That may be right,
     * but it is a decision about what this guild publishes and it should not
     * pass unnoticed. See §6.
     */
    const source = readFileSync(path.join(__dirname, "public-profile.ts"), "utf8");
    const forbidden = [
      "status",
      "award",
      "Award",
      "standing",
      "Standing",
      "attendance",
      "Attendance",
      "priority",
      "Priority",
      "comment",
      "Comment",
      "wishlist",
      "Wishlist",
      "membershipId",
    ];
    // Comments are stripped first: several of these words appear in prose here
    // explaining precisely why they are absent, and a test that could not tell
    // an explanation from a leak would push the explanation out of the file.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(forbidden.filter((word) => code.includes(word))).toEqual([]);
  });

  it("publishes only the four character fields it names", () => {
    const p = buildPublicProfile(input("open"));
    for (const character of p.roster ?? []) {
      expect(Object.keys(character).sort()).toEqual(["name", "role", "spec", "wowClass"]);
    }
  });
});

describe("the setting itself", () => {
  it("starts closed, so a deployment upgrading into this publishes nothing by surprise", () => {
    expect(DEFAULT_VISIBILITY).toBe("private");
  });

  it("refuses a value it does not know", () => {
    expect(isGuildVisibility("open")).toBe(true);
    expect(isGuildVisibility("public")).toBe(false);
    expect(isGuildVisibility(undefined)).toBe(false);
  });
});
