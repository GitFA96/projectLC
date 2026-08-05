import { describe, expect, it } from "vitest";
import { parseReportCodes } from "@/lib/wcl/report-codes";

/** Real codes from this guild's imports. */
const A = "8Y9ZFmK2jfBdHzgJ";
const B = "dh7fyBp4bmwvMaYV";
const C = "zydGxhTM8Y4CjL7m";

describe("parseReportCodes", () => {
  it("reads a plain newline-separated list of URLs", () => {
    const text = `https://www.warcraftlogs.com/reports/${A}
https://www.warcraftlogs.com/reports/${B}`;
    expect(parseReportCodes(text).codes).toEqual([A, B]);
  });

  it("accepts bare codes", () => {
    expect(parseReportCodes(`${A}\n${B}`).codes).toEqual([A, B]);
  });

  it("mixes URLs and bare codes in one paste", () => {
    expect(parseReportCodes(`https://www.warcraftlogs.com/reports/${A}\n${B}`).codes).toEqual([A, B]);
  });

  it("keeps a fight fragment from being read as a separator", () => {
    // Splitting on commas first would turn `#fight=1,2` into junk tokens.
    const text = `https://www.warcraftlogs.com/reports/${A}#fight=1,2&type=damage-done`;
    const parsed = parseReportCodes(text);
    expect(parsed.codes).toEqual([A]);
    expect(parsed.invalid).toEqual([]);
  });

  it("handles comma and semicolon separated lists", () => {
    expect(parseReportCodes(`${A}, ${B}; ${C}`).codes).toEqual([A, B, C]);
  });

  it("survives a locale prefix in the URL", () => {
    expect(parseReportCodes(`https://www.warcraftlogs.com/reports/eu-${A}`).codes).toEqual([A]);
  });

  it("preserves the pasted order — the queue runs in it", () => {
    expect(parseReportCodes(`${C}\n${A}\n${B}`).codes).toEqual([C, A, B]);
  });

  it("collapses duplicates and counts them", () => {
    const parsed = parseReportCodes(`${A}\n${A}\nhttps://www.warcraftlogs.com/reports/${A}`);
    expect(parsed.codes).toEqual([A]);
    expect(parsed.duplicates).toBe(2);
  });

  it("reports fragments that look like nothing we know", () => {
    const parsed = parseReportCodes(`${A}\nnot-a-report\n`);
    expect(parsed.codes).toEqual([A]);
    expect(parsed.invalid).toEqual(["not-a-report"]);
  });

  it("does not flag the leftovers of a consumed URL as invalid", () => {
    const parsed = parseReportCodes(`https://www.warcraftlogs.com/reports/${A}?foo=1`);
    expect(parsed.codes).toEqual([A]);
    expect(parsed.invalid).toEqual([]);
  });

  it("returns nothing for empty or whitespace-only input", () => {
    expect(parseReportCodes("   \n  ")).toEqual({ codes: [], duplicates: 0, invalid: [] });
  });

  it("handles a messy real-world paste", () => {
    const text = `
      Raid nights this phase:
      https://www.warcraftlogs.com/reports/${A}#fight=last
      ${B}
      https://www.warcraftlogs.com/reports/${C}
    `;
    expect(parseReportCodes(text).codes).toEqual([A, B, C]);
  });
});
