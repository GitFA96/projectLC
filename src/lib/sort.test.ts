import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compareText } from "@/lib/sort";

describe("compareText", () => {
  it("does not change its answer with the host's locale", () => {
    // The whole point. Under nb-NO a bare localeCompare puts Aandor after Zul,
    // because Norwegian collates "aa" as "å"; naming the locale fixes the order
    // to one the code chose rather than one the container did.
    expect(compareText("Aandor", "Zul")).toBeLessThan(0);
  });

  it("ties on case and accents rather than separating them", () => {
    expect(compareText("Ashbringer", "ashbringer")).toBe(0);
  });

  it("sorts embedded numbers as numbers", () => {
    expect(compareText("Phase 2", "Phase 10")).toBeLessThan(0);
  });

  it("still orders ISO timestamps the ordinary way", () => {
    // Half the call sites sort these. Worth pinning that routing them through a
    // collator did not quietly change anything.
    expect(compareText("2026-08-01T10:00:00Z", "2026-08-12T09:00:00Z")).toBeLessThan(0);
  });
});

describe("nothing calls localeCompare directly", () => {
  // The sites that existed were swept in one go; the ones that matter are the
  // ones written next week, the obvious way, by somebody who never read
  // docs/pitfalls.md. That is what this catches — see src/lib/sort.ts.
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) return entry === "node_modules" ? [] : walk(full);
      return /\.tsx?$/.test(full) ? [full] : [];
    });

  it("has no bare .localeCompare( anywhere in src", () => {
    const root = path.join(process.cwd(), "src");
    const offenders = walk(root)
      .map((f) => ({ file: f, rel: path.relative(root, f).split(path.sep).join("/") }))
      // sort.ts defines the replacement; this file names the banned string.
      .filter(({ rel }) => !rel.startsWith("lib/sort."))
      .filter(({ file }) => readFileSync(file, "utf8").includes(".localeCompare("))
      .map(({ rel }) => `src/${rel}`);

    expect(offenders).toEqual([]);
  });
});
