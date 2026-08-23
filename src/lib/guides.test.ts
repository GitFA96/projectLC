import { describe, expect, it } from "vitest";
import {
  OPERATOR_OWNER,
  bossFromSlug,
  classFromSlug,
  classSlug,
  findGuides,
  guideCoverage,
  guideSlots,
  raidSections,
  sourceHref,
  zoneFromSlug,
  zoneSlug,
  type Guide,
  type GuideKind,
} from "@/lib/guides";

const GUILD = "g1";

const guide = (
  kind: GuideKind,
  subject: string,
  section: string,
  owner: string = GUILD,
): Guide => ({
  kind,
  subject,
  section,
  owner,
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

describe("zone and boss slugs", () => {
  it("round-trips a zone whose name has an apostrophe", () => {
    // Punctuation has to drop out or the URL breaks in ways that are hard to see.
    expect(zoneFromSlug(zoneSlug("Gruul's Lair"))).toBe("Gruul's Lair");
    expect(zoneFromSlug(zoneSlug("Zul'Aman"))).toBe("Zul'Aman");
  });

  it("round-trips a boss, article and all", () => {
    expect(bossFromSlug("Black Temple", zoneSlug("The Illidari Council"))).toBe(
      "The Illidari Council",
    );
    expect(bossFromSlug("Mount Hyjal", zoneSlug("Kaz'rogal"))).toBe("Kaz'rogal");
  });

  it("refuses a boss from the wrong raid", () => {
    expect(bossFromSlug("Mount Hyjal", zoneSlug("Supremus"))).toBeUndefined();
  });
});

describe("raidSections", () => {
  it("leads with trash, then the raid's own order", () => {
    // The order the raid meets them, matching the loot plan's spine.
    expect(raidSections("Mount Hyjal")).toEqual([
      "Trash",
      "Rage Winterchill",
      "Anetheron",
      "Kaz'rogal",
      "Azgalor",
      "Archimonde",
    ]);
  });

  it("is empty for something that isn't a raid", () => {
    expect(raidSections("Crafted")).toEqual([]);
  });
});

describe("guideSlots", () => {
  it("leads with the shared guide, then every spec", () => {
    expect(guideSlots("Warrior")).toEqual([
      { section: "", label: "All specs" },
      { section: "Arms", label: "Arms" },
      { section: "Fury", label: "Fury" },
      { section: "Protection", label: "Protection" },
    ]);
  });
});

describe("findGuides", () => {
  it("keeps the two owners apart rather than picking one", () => {
    // Neither is the winner: the baseline explains the thing, the guild's own
    // says what they do about it. A page needs both, labelled.
    const guides = [
      guide("class", "Warrior", "Fury", OPERATOR_OWNER),
      guide("class", "Warrior", "Fury", GUILD),
    ];
    const pair = findGuides(guides, "class", "Warrior", "Fury", GUILD);
    expect(pair.template?.owner).toBe(OPERATOR_OWNER);
    expect(pair.own?.owner).toBe(GUILD);
  });

  it("does not hand one guild another guild's notes", () => {
    const pair = findGuides([guide("class", "Warrior", "Fury", "other-guild")], "class", "Warrior", "Fury", GUILD);
    expect(pair.own).toBeUndefined();
    expect(pair.template).toBeUndefined();
  });

  it("tells the subject-level guide apart from a section's", () => {
    const guides = [guide("class", "Warrior", ""), guide("class", "Warrior", "Fury")];
    expect(findGuides(guides, "class", "Warrior", "", GUILD).own?.section).toBe("");
    expect(findGuides(guides, "class", "Warrior", "Fury", GUILD).own?.section).toBe("Fury");
  });

  it("matches a boss across a spelling, the way every other boss lookup does", () => {
    // A guide written while a source said "Illidari Council" has to be found
    // when the page heading says "The Illidari Council".
    const guides = [guide("raid", "Black Temple", "Illidari Council")];
    expect(findGuides(guides, "raid", "Black Temple", "The Illidari Council", GUILD).own).toBeDefined();
  });

  it("keeps a class section exact, because those are a closed set", () => {
    const guides = [guide("class", "Warrior", "Fury")];
    expect(findGuides(guides, "class", "Warrior", "fury", GUILD).own).toBeUndefined();
  });
});

describe("guideCoverage", () => {
  const sections = guideSlots("Warrior").map((s) => s.section);

  it("counts written slots against the total", () => {
    const guides = [guide("class", "Warrior", ""), guide("class", "Warrior", "Fury")];
    expect(guideCoverage(guides, "class", "Warrior", sections, GUILD)).toEqual({
      written: 2,
      total: 4,
    });
  });

  it("counts a shared baseline as written, since a reader can read it", () => {
    const guides = [guide("class", "Warrior", "", OPERATOR_OWNER)];
    expect(guideCoverage(guides, "class", "Warrior", sections, GUILD).written).toBe(1);
  });

  it("doesn't count another subject's guides", () => {
    const guides = [guide("class", "Hunter", "Survival")];
    expect(guideCoverage(guides, "class", "Warrior", sections, GUILD).written).toBe(0);
  });

  it("counts raid sections the same way", () => {
    const guides = [guide("raid", "Mount Hyjal", "Archimonde")];
    expect(guideCoverage(guides, "raid", "Mount Hyjal", raidSections("Mount Hyjal"), GUILD)).toEqual(
      { written: 1, total: 6 },
    );
  });
});

describe("sourceHref", () => {
  it("links a URL and leaves plain text alone", () => {
    expect(sourceHref("https://wowhead.com/x")).toBe("https://wowhead.com/x");
    expect(sourceHref("Bloodmallet, March")).toBeUndefined();
  });

  it("refuses a scheme that isn't http", () => {
    // It must never become an href.
    expect(sourceHref("javascript:alert(1)")).toBeUndefined();
  });
});
