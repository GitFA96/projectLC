import { describe, expect, it } from "vitest";
import { nightHref, toggleRaid, withRaidPicks } from "@/components/logs/raid-filter-url";

describe("withRaidPicks", () => {
  // The filter presses while a night is open. Rebuilding the query from the
  // picks alone would close it.
  it("keeps every other parameter", () => {
    const out = withRaidPicks("report=abc123&prep=food", ["Black Temple"]);
    const params = new URLSearchParams(out);
    expect(params.get("report")).toBe("abc123");
    expect(params.get("prep")).toBe("food");
    expect(params.getAll("raid")).toEqual(["Black Temple"]);
  });

  it("replaces the old picks rather than adding to them", () => {
    const out = withRaidPicks("raid=Karazhan&report=abc123", ["Black Temple", "Mount Hyjal"]);
    expect(new URLSearchParams(out).getAll("raid")).toEqual(["Black Temple", "Mount Hyjal"]);
  });

  // The unfiltered URL should be the plain one somebody would write by hand.
  it("drops the parameter entirely when nothing is picked", () => {
    expect(withRaidPicks("raid=Karazhan&report=abc123", [])).toBe("report=abc123");
    expect(withRaidPicks("raid=Karazhan", [])).toBe("");
  });

  // A separator chosen here is one some raid name eventually contains.
  it("survives a raid name with punctuation in it", () => {
    const out = withRaidPicks("", ["Gruul's Lair", "Magtheridon's Lair"]);
    expect(out).not.toContain(" ");
    expect(new URLSearchParams(out).getAll("raid")).toEqual([
      "Gruul's Lair",
      "Magtheridon's Lair",
    ]);
  });
});

describe("nightHref", () => {
  it("carries the picks so choosing a night keeps the narrowing", () => {
    const params = new URLSearchParams(nightHref("abc123", ["Black Temple"]).split("?")[1]);
    expect(params.get("report")).toBe("abc123");
    expect(params.getAll("raid")).toEqual(["Black Temple"]);
  });

  it("is the plain report link when nothing is picked", () => {
    expect(nightHref("abc123", [])).toBe("/logs?report=abc123");
  });

  // The tab and the report in the current URL belong to the night being left.
  it("does not carry the outgoing night's other parameters", () => {
    expect(nightHref("newcode", [])).not.toContain("prep");
  });
});

describe("toggleRaid", () => {
  it("adds a raid that is not picked, at the end", () => {
    expect(toggleRaid(["Black Temple"], "Mount Hyjal")).toEqual(["Black Temple", "Mount Hyjal"]);
  });

  it("removes one that is, leaving the rest in order", () => {
    expect(toggleRaid(["Black Temple", "Mount Hyjal", "Karazhan"], "Mount Hyjal")).toEqual([
      "Black Temple",
      "Karazhan",
    ]);
  });

  it("does not mutate what it was given", () => {
    const picked = ["Black Temple"];
    expect(toggleRaid(picked, "Karazhan")).not.toBe(picked);
    expect(picked).toEqual(["Black Temple"]);
  });
});
