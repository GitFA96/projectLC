import { describe, expect, it } from "vitest";
import { resetWeekStart } from "@/lib/analysis/performance";

describe("resetWeekStart (EU reset, Wednesday)", () => {
  it("a Wednesday raid opens its own week", () => {
    expect(resetWeekStart("2026-06-10T19:30:00.000Z")).toBe("2026-06-10");
    expect(resetWeekStart("2026-06-10T00:00:00.000Z")).toBe("2026-06-10");
  });

  it("a Tuesday-night raid belongs to the closing week", () => {
    expect(resetWeekStart("2026-06-09T22:30:00.000Z")).toBe("2026-06-03");
  });

  it("mid-week days map back to the opening Wednesday", () => {
    expect(resetWeekStart("2026-06-07T20:00:00.000Z")).toBe("2026-06-03"); // Sunday
    expect(resetWeekStart("2026-06-12T21:00:00.000Z")).toBe("2026-06-10"); // Friday
  });

  it("crosses month boundaries", () => {
    expect(resetWeekStart("2026-07-01T20:00:00.000Z")).toBe("2026-07-01"); // Wed 1 Jul
    expect(resetWeekStart("2026-06-30T20:00:00.000Z")).toBe("2026-06-24"); // Tue 30 Jun
  });
});
