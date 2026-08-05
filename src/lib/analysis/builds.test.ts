import { describe, expect, it } from "vitest";
import {
  buildMatchNote,
  buildOf,
  buildsPlayed,
  compareBuilds,
  hasBuild,
} from "@/lib/analysis/builds";

/** Real splits from this guild's logs: Katzewarr's hybrid vs Scomb's pure Fury. */
const KEBAB = [33, 28, 0];
const FURY = [21, 40, 0];

describe("buildOf", () => {
  it("labels a build by its point split", () => {
    expect(buildOf(KEBAB).label).toBe("33/28/0");
    expect(buildOf(FURY).key).toBe("21/40/0");
  });

  it("treats a missing talent array as unknown, not as a build", () => {
    expect(buildOf([]).label).toBeUndefined();
    expect(buildOf(undefined).key).toBeUndefined();
    expect(hasBuild([])).toBe(false);
  });

  it("keeps an all-zero build — logged-but-unspent is not the same as unlogged", () => {
    expect(buildOf([0, 0, 0]).label).toBe("0/0/0");
    expect(hasBuild([0, 0, 0])).toBe(true);
  });

  it("copies the array so a caller can't mutate the source pull", () => {
    const source = [33, 28, 0];
    const build = buildOf(source);
    build.talents[0] = 99;
    expect(source[0]).toBe(33);
  });
});

describe("compareBuilds", () => {
  it("separates two warriors WCL would happily compare", () => {
    // Both are "Warrior"; WCL calls one Arms and one Fury, but the point that
    // matters is that the ceilings differ.
    expect(compareBuilds(buildOf(KEBAB), buildOf(FURY))).toBe("different");
  });

  it("matches identical splits", () => {
    expect(compareBuilds(buildOf(FURY), buildOf([21, 40, 0]))).toBe("same");
  });

  it("reports unknown when either side has no talents, never 'different'", () => {
    expect(compareBuilds(buildOf(FURY), buildOf([]))).toBe("unknown");
    expect(compareBuilds(buildOf([]), buildOf([]))).toBe("unknown");
  });

  it("does not treat two unknowns as a match", () => {
    // Two pulls from before talent capture are not evidence of the same build.
    expect(compareBuilds(buildOf(undefined), buildOf(undefined))).not.toBe("same");
  });
});

describe("buildMatchNote", () => {
  it("stays silent when the builds agree", () => {
    expect(buildMatchNote(buildOf(FURY), buildOf(FURY))).toBeUndefined();
  });

  it("names both builds so the reader can judge the comparison themselves", () => {
    const note = buildMatchNote(buildOf(KEBAB), buildOf(FURY))!;
    expect(note).toContain("33/28/0");
    expect(note).toContain("21/40/0");
  });

  it("points at the re-import when talents are missing", () => {
    expect(buildMatchNote(buildOf(FURY), buildOf([]))!).toMatch(/re-import/i);
  });
});

describe("buildsPlayed", () => {
  it("shows a raider swapping builds across a season, commonest first", () => {
    const fights = [
      { talents: FURY }, { talents: FURY }, { talents: FURY },
      { talents: KEBAB }, { talents: KEBAB },
    ];
    expect(buildsPlayed(fights)).toEqual([
      { build: buildOf(FURY), pulls: 3 },
      { build: buildOf(KEBAB), pulls: 2 },
    ]);
  });

  it("ignores pulls with no talents rather than inventing a build for them", () => {
    expect(buildsPlayed([{ talents: [] }, { talents: FURY }])).toEqual([
      { build: buildOf(FURY), pulls: 1 },
    ]);
  });

  it("returns nothing when no pull carries talents", () => {
    expect(buildsPlayed([{ talents: [] }])).toEqual([]);
  });
});
