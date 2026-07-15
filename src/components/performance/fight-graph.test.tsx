// @vitest-environment node
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { FightGraphView } from "@/lib/wcl/fight-graph";
import { DpsChart } from "@/components/performance/fight-graph";

const data: FightGraphView = {
  encounterName: "Void Reaver",
  kill: true,
  durationMs: 158_371,
  bucketMs: 659.879,
  dps: Array.from({ length: 241 }, (_, i) => (i < 3 ? 0 : 900 + 500 * Math.sin(i / 9))),
  casts: [
    { t: 10_942, name: "Death Wish", kind: "cooldown" },
    { t: 12_100, name: "Haste Potion", kind: "consumable" },
  ],
  buffs: [
    { name: "Lightning Speed", pct: 49, uses: 7, segments: [[24_720, 39_725], [47_735, 62_743]] },
    { name: "Lust for Battle", pct: 25, uses: 2, segments: [[10_942, 30_947]] },
  ],
  bossHealth: Array.from({ length: 100 }, (_, i) => [i * 1584, 100 - i] as [number, number]),
  bossName: "Void Reaver",
  bossMaxHp: 4_140_800,
};

describe("DpsChart", () => {
  it("renders sane SVG geometry — no NaN, all layers present", () => {
    const html = renderToStaticMarkup(<DpsChart data={data} />);
    expect(html).not.toContain("NaN");
    expect(html).toContain("<svg");
    // Line + area + both cast markers + buff lanes + legend + cast list.
    expect(html).toContain('stroke-width="2"');
    // Two markers on the line + one dot in the Haste Potion consume lane.
    expect(html.match(/<circle/g)?.length).toBe(3);
    expect(html).toContain("Lightning Speed");
    expect(html).toContain("Death Wish");
    expect(html).toContain("cooldown cast");
    expect(html).toContain("0:12 Haste Potion");
    // Clean y-axis ceiling for a ~1400 max: 1.5k ticks would be 2k/1k etc.
    expect(html).toMatch(/>2k</);
    // Boss health strip: legend key, gutter label and its own % scale.
    expect(html).toContain("boss health");
    expect(html).toContain("Void Reaver hp");
    expect(html).toContain(">100%<");
  });

  it("handles an empty fight without dividing by zero", () => {
    const html = renderToStaticMarkup(
      <DpsChart data={{ ...data, dps: [], casts: [], buffs: [], bossHealth: undefined, bossName: undefined }} />,
    );
    expect(html).not.toContain("NaN");
    // No boss data → no strip: neither the gutter label nor the % scale.
    expect(html).not.toContain("hp</text>");
    expect(html).not.toContain(">100%<");
  });
});
