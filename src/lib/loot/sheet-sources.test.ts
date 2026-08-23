import { describe, expect, it } from "vitest";

import { LOOT_PRIORITY_SHEET_MD } from "@/data/seed/loot-priority-p3";
import { sheetSectionSource } from "@/lib/loot/sheet-sources";
import { parsePrioritySheet } from "@/lib/loot/priority-sheet";

describe("sheetSectionSource", () => {
  it("reads a boss heading as that boss's raid", () => {
    expect(sheetSectionSource("Teron Gorefiend")).toEqual({
      zone: "Black Temple",
      boss: "Teron Gorefiend",
    });
  });

  it("answers with the raid table's spelling, not the heading's", () => {
    // The sheet drops the apostrophes; the cache and the logs keep them. If this
    // returned the heading verbatim the two would never group together.
    expect(sheetSectionSource("Kazrogal")?.boss).toBe("Kaz'rogal");
    expect(sheetSectionSource("High Warlord Najentus")?.boss).toBe("High Warlord Naj'entus");
  });

  it("matches across a leading article, in either direction", () => {
    expect(sheetSectionSource("The Illidari Council")?.boss).toBe("The Illidari Council");
    expect(sheetSectionSource("Illidari Council")?.boss).toBe("The Illidari Council");
  });

  it("files trash under its zone", () => {
    expect(sheetSectionSource("Hyjal Trash")).toEqual({ zone: "Mount Hyjal", boss: "Trash" });
    expect(sheetSectionSource("Black Temple Trash")).toEqual({
      zone: "Black Temple",
      boss: "Trash",
    });
  });

  it("takes a raid's short name for trash", () => {
    expect(sheetSectionSource("BT Trash")).toEqual({ zone: "Black Temple", boss: "Trash" });
  });

  it("says nothing rather than guessing", () => {
    // A bare "Trash" names no zone, and an empty key must not match by
    // containment — that would hand every unlabelled section to Karazhan.
    expect(sheetSectionSource("Trash")).toBeUndefined();
    expect(sheetSectionSource("Notation")).toBeUndefined();
    expect(sheetSectionSource("")).toBeUndefined();
    expect(sheetSectionSource("Some Future Boss")).toBeUndefined();
  });
});

describe("the guild's own P3 sheet", () => {
  const sections = [...new Set(parsePrioritySheet(LOOT_PRIORITY_SHEET_MD).map((r) => r.source))];

  it("has every section resolve to a drop source", () => {
    // The sheet the guild actually raids from is the case that matters. A
    // heading this can't read is loot that stays invisible on the plan, so a
    // future paste that adds one should fail here rather than in a raid.
    const unresolved = sections.filter((s) => !sheetSectionSource(s));
    expect(unresolved).toEqual([]);
  });

  it("covers both P3 raids and nothing else", () => {
    const zones = new Set(sections.map((s) => sheetSectionSource(s)?.zone));
    expect([...zones].sort()).toEqual(["Black Temple", "Mount Hyjal"]);
  });
});
