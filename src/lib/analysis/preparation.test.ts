import { describe, expect, it } from "vitest";
import { hasFlaskOrElixir, isPrepared, type PreparationRow } from "@/lib/analysis/preparation";

const row = (over: Partial<PreparationRow> = {}): PreparationRow => ({
  elixirs: [],
  food: false,
  ...over,
});

describe("hasFlaskOrElixir", () => {
  it("counts a flask", () => {
    expect(hasFlaskOrElixir(row({ flask: "Flask of Relentless Assault" }))).toBe(true);
  });

  it("counts a single elixir — a battle elixir is coverage, not nothing", () => {
    expect(hasFlaskOrElixir(row({ elixirs: ["Elixir of Major Agility"] }))).toBe(true);
  });

  it("is false with neither", () => {
    expect(hasFlaskOrElixir(row())).toBe(false);
  });

  it("ignores food — that is the other half of the answer", () => {
    expect(hasFlaskOrElixir(row({ food: true }))).toBe(false);
  });
});

describe("isPrepared", () => {
  it("needs coverage and food together", () => {
    expect(isPrepared(row({ flask: "Flask of Fortification", food: true }))).toBe(true);
    expect(isPrepared(row({ elixirs: ["Elixir of Major Agility"], food: true }))).toBe(true);
  });

  it("is false with food alone", () => {
    expect(isPrepared(row({ food: true }))).toBe(false);
  });

  it("is false with coverage alone", () => {
    expect(isPrepared(row({ flask: "Flask of Relentless Assault" }))).toBe(false);
  });
});
