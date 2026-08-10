import { describe, expect, it } from "vitest";
import {
  classFromSlug,
  classSlug,
  findGuide,
  guideCoverage,
  guideSlots,
  sourceHref,
  type ClassGuide,
} from "@/lib/guides";

const guide = (wowClass: string, spec: string): ClassGuide => ({
  wowClass,
  spec,
  body: "Flask up.",
  sources: [],
  updatedAt: "2026-08-08T00:00:00.000Z",
});

describe("class slugs", () => {
  it("round-trips every class", () => {
    for (const wowClass of ["Warrior", "Hunter", "Warlock"] as const) {
      expect(classFromSlug(classSlug(wowClass))).toBe(wowClass);
    }
  });

  it("is case-insensitive, because URLs get typed by hand", () => {
    expect(classFromSlug("WARRIOR")).toBe("Warrior");
  });

  it("returns undefined for something that isn't a class", () => {
    expect(classFromSlug("deathknight")).toBeUndefined();
  });
});

describe("guideSlots", () => {
  it("leads with the shared guide, then every spec", () => {
    expect(guideSlots("Warrior")).toEqual([
      { spec: "", label: "All specs" },
      { spec: "Arms", label: "Arms" },
      { spec: "Fury", label: "Fury" },
      { spec: "Protection", label: "Protection" },
    ]);
  });
});

describe("guideCoverage", () => {
  it("counts written slots against the total", () => {
    const guides = [guide("Warrior", ""), guide("Warrior", "Fury"), guide("Hunter", "")];
    expect(guideCoverage(guides, "Warrior")).toEqual({ written: 2, total: 4 });
    expect(guideCoverage(guides, "Mage")).toEqual({ written: 0, total: 4 });
  });

  it("doesn't count another class's guides", () => {
    expect(guideCoverage([guide("Hunter", "Survival")], "Warrior").written).toBe(0);
  });
});

describe("findGuide", () => {
  it("tells the class-level guide apart from a spec's", () => {
    const guides = [guide("Warrior", ""), guide("Warrior", "Fury")];
    expect(findGuide(guides, "Warrior", "")?.spec).toBe("");
    expect(findGuide(guides, "Warrior", "Fury")?.spec).toBe("Fury");
    expect(findGuide(guides, "Warrior", "Arms")).toBeUndefined();
  });
});

describe("sourceHref", () => {
  it("links a real URL", () => {
    expect(sourceHref("https://www.wowhead.com/tbc/guide/x")).toBe(
      "https://www.wowhead.com/tbc/guide/x",
    );
  });

  it("leaves prose as prose rather than inventing a link", () => {
    expect(sourceHref("Bloodmallet, March")).toBeUndefined();
    expect(sourceHref("")).toBeUndefined();
  });

  it("refuses a scheme that isn't http(s) — an officer's paste is not a trusted href", () => {
    expect(sourceHref("javascript:alert(1)")).toBeUndefined();
    expect(sourceHref("data:text/html;base64,PHNjcmlwdD4=")).toBeUndefined();
  });
});
