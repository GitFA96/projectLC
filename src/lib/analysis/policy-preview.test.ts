import { describe, expect, it } from "vitest";
import { buildPolicyPreview, type PolicyPreviewRow } from "@/lib/analysis/policy-preview";

const row = (over: Partial<PolicyPreviewRow> & { name: string }): PolicyPreviewRow => ({
  preparedBefore: 100,
  preparedAfter: 100,
  attendanceBefore: 80,
  attendanceAfter: 80,
  ...over,
});

describe("buildPolicyPreview", () => {
  it("says plainly when nothing moves", () => {
    const preview = buildPolicyPreview([row({ name: "A" }), row({ name: "B" })]);
    expect(preview.moved).toEqual([]);
    expect(preview.measured).toBe(2);
    expect(preview.toZero).toEqual([]);
  });

  it("reports only the raiders whose numbers changed", () => {
    const preview = buildPolicyPreview([
      row({ name: "Stays" }),
      row({ name: "Moves", preparedAfter: 60 }),
    ]);
    expect(preview.moved.map((r) => r.name)).toEqual(["Moves"]);
  });

  it("orders worst-hit first", () => {
    const preview = buildPolicyPreview([
      row({ name: "Small", preparedAfter: 90 }),
      row({ name: "Huge", preparedAfter: 0 }),
      row({ name: "Medium", preparedAfter: 50 }),
    ]);
    expect(preview.moved.map((r) => r.name)).toEqual(["Huge", "Medium", "Small"]);
  });

  it("calls out a fall to zero separately — it starts a different argument", () => {
    const preview = buildPolicyPreview([
      row({ name: "Gone", preparedAfter: 0 }),
      row({ name: "Dented", preparedAfter: 70 }),
    ]);
    expect(preview.toZero.map((r) => r.name)).toEqual(["Gone"]);
  });

  it("doesn't call someone a fall to zero when they were already there", () => {
    const preview = buildPolicyPreview([
      row({ name: "Never had any", preparedBefore: 0, preparedAfter: 0, attendanceAfter: 50 }),
    ]);
    expect(preview.toZero).toEqual([]);
    expect(preview.moved.map((r) => r.name)).toEqual(["Never had any"]);
  });

  it("averages the roster before and after", () => {
    const preview = buildPolicyPreview([
      row({ name: "A", preparedBefore: 100, preparedAfter: 0 }),
      row({ name: "B", preparedBefore: 50, preparedAfter: 50 }),
    ]);
    expect(preview.avgPreparedBefore).toBe(75);
    expect(preview.avgPreparedAfter).toBe(25);
  });

  it("counts an attendance-only change as a move", () => {
    const preview = buildPolicyPreview([row({ name: "A", attendanceAfter: 40 })]);
    expect(preview.moved).toHaveLength(1);
    expect(preview.avgPreparedBefore).toBe(preview.avgPreparedAfter);
  });
});
