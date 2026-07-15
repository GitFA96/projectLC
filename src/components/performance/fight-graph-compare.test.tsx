// @vitest-environment node
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { FightGraphView } from "@/lib/wcl/fight-graph";
import { OverlayChart } from "@/components/performance/fight-graph-compare";

function view(over: Partial<FightGraphView>): FightGraphView {
  return {
    encounterName: "Void Reaver",
    kill: true,
    durationMs: 158_000,
    bucketMs: 660,
    dps: Array.from({ length: 240 }, (_, i) => 800 + 400 * Math.sin(i / 7)),
    casts: [{ t: 12_000, name: "Death Wish", kind: "cooldown" }],
    buffs: [{ name: "Lightning Speed", pct: 40, uses: 4, segments: [[10_000, 25_000]] }],
    bossHealth: Array.from({ length: 80 }, (_, i) => [i * 1975, 100 - i * 1.25] as [number, number]),
    bossName: "Void Reaver",
    ...over,
  };
}

const instances = [
  { key: "a", color: "#2a78d6", label: "Stiligwarr · Void Reaver · 9 Jun", data: view({}) },
  {
    key: "b",
    color: "#eb6834",
    label: "Wando · Void Reaver · 2 Jun",
    // Shorter pull, consumable cast → square marker, no boss data.
    data: view({
      durationMs: 120_000,
      dps: Array.from({ length: 180 }, () => 900),
      casts: [{ t: 30_000, name: "Haste Potion", kind: "consumable" }],
      buffs: [{ name: "Lust for Battle", pct: 25, uses: 2, segments: [[5_000, 25_000]] }],
      bossHealth: undefined,
      bossName: undefined,
    }),
  },
];

describe("OverlayChart", () => {
  it("renders both instances color-coded on one axis, no NaN", () => {
    const html = renderToStaticMarkup(<OverlayChart instances={instances} />);
    expect(html).not.toContain("NaN");
    // Two DPS lines in the two instance colors.
    expect(html.match(/stroke="#2a78d6"/g)?.length).toBeGreaterThanOrEqual(1);
    expect(html.match(/stroke="#eb6834"/g)?.length).toBeGreaterThanOrEqual(1);
    // Marker shapes: circle for the cooldown, rect (square) for the consumable.
    expect(html).toContain("<circle");
    expect(html).toContain("Haste Potion");
    // Player-prefixed buff lanes from both instances.
    expect(html).toContain("Stiligwarr · Lightning Speed");
    expect(html).toContain("Wando · Lust for Battle");
    // Boss strip renders from the one instance that has it.
    expect(html).toContain("boss hp");
    // Time axis spans the LONGER fight.
    expect(html).toContain(">2:38<");
  });

  it("renders a single instance without a second color", () => {
    const html = renderToStaticMarkup(<OverlayChart instances={[instances[0]]} />);
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("#eb6834");
  });

  it("hides filtered buffs and dims non-highlighted lanes", () => {
    const hidden = renderToStaticMarkup(
      <OverlayChart instances={instances} buffFilter={{ "Lightning Speed": "hidden" }} />,
    );
    expect(hidden).not.toContain("Lightning Speed");
    expect(hidden).toContain("Lust for Battle");

    const highlighted = renderToStaticMarkup(
      <OverlayChart instances={instances} buffFilter={{ "Lust for Battle": "highlight" }} />,
    );
    // The non-highlighted buff lane dims; the highlighted one stays full.
    expect(highlighted).toContain('opacity="0.25"');
    expect(highlighted).toContain("Lust for Battle");
  });
});
