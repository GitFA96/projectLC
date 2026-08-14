import { describe, expect, it } from "vitest";
import { findStaleReports } from "@/lib/analysis/stale-reports";
import { classifyAura } from "@/lib/wcl/consumables";
import type { WclReport } from "@/lib/types";

function report(over: Partial<WclReport> & { code: string }): WclReport {
  return {
    title: "SSC night",
    zone: "Serpentshrine Cavern",
    startTime: "2026-08-01T19:00:00.000Z",
    endTime: "2026-08-01T23:00:00.000Z",
    fetchedAt: "2026-08-01T23:30:00.000Z",
    upkeepTracks: [],
    unclassifiedAuras: [],
    raidSessionId: null,
    ...over,
  } as WclReport;
}

describe("findStaleReports", () => {
  it("flags a report whose dump names a consumable the tables now know", () => {
    // The real case: 17628 sat in this dump as "Supreme Power" at 11 pulls while
    // the tables had no entry for it, so eleven pulls graded as no flask.
    const stale = findStaleReports(
      [
        report({
          code: "zydGxhTM8Y4CjL7m",
          unclassifiedAuras: [{ name: "Supreme Power", abilityId: 17628, count: 11 }],
        }),
      ],
      classifyAura,
    );
    expect(stale).toHaveLength(1);
    expect(stale[0].pulls).toBe(11);
    expect(stale[0].learned[0]).toMatchObject({
      label: "Flask of Supreme Power",
      category: "flask",
    });
  });

  it("stays quiet about an aura later ruled a class buff", () => {
    // "Greater Intellect" was flagged, probed, and filed as a mage self-buff.
    // Re-importing would tidy the dump and move no number, so asking an officer
    // to spend an evening on it would be spending it for nothing.
    const stale = findStaleReports(
      [
        report({
          code: "quiet",
          unclassifiedAuras: [{ name: "Greater Intellect", abilityId: 11396, count: 11 }],
        }),
      ],
      classifyAura,
    );
    expect(stale).toEqual([]);
  });

  it("says nothing about a report whose dump is still unknown", () => {
    const stale = findStaleReports(
      [report({ code: "unknown", unclassifiedAuras: [{ name: "Mystery Brew", count: 4 }] })],
      classifyAura,
    );
    expect(stale).toEqual([]);
  });

  it("says nothing about a report with no dump recorded", () => {
    // Imported before the dump was kept. "Not recorded" is not "nothing was
    // unknown", and this cannot tell the difference — so it claims neither.
    expect(findStaleReports([report({ code: "old" })], classifyAura)).toEqual([]);
  });

  it("ranks the biggest correction first", () => {
    const stale = findStaleReports(
      [
        report({ code: "small", unclassifiedAuras: [{ name: "Supreme Power", abilityId: 17628, count: 2 }] }),
        report({ code: "big", unclassifiedAuras: [{ name: "Supreme Power", abilityId: 17628, count: 40 }] }),
      ],
      classifyAura,
    );
    expect(stale.map((s) => s.code)).toEqual(["big", "small"]);
  });

  it("adds up the pulls across several learned auras", () => {
    const stale = findStaleReports(
      [
        report({
          code: "two",
          unclassifiedAuras: [
            { name: "Supreme Power", abilityId: 17628, count: 11 },
            { name: "Chromatic Resistance", abilityId: 17629, count: 1 },
            { name: "Mystery Brew", count: 99 },
          ],
        }),
      ],
      classifyAura,
    );
    // Only the two it learned; the unknown one is not a reason to re-import.
    expect(stale[0].learned).toHaveLength(2);
    expect(stale[0].pulls).toBe(12);
  });
});
