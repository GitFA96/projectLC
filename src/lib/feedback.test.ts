import { describe, expect, it } from "vitest";
import {
  browserLabel,
  contextLines,
  formatReportForAgent,
  formatReportsForAgent,
  isEmptyContext,
  likelyRouteFile,
  truncate,
} from "@/lib/feedback";
import type { FeedbackReport } from "@/lib/types";

/**
 * The reporter is shown exactly what a report will contain, so these helpers
 * are the consent surface as much as they are formatting. A line that renders
 * differently from what gets stored would make that promise false.
 */

describe("browserLabel", () => {
  it("names the browser and OS a raider would recognise", () => {
    expect(
      browserLabel(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      ),
    ).toBe("Chrome 141 on Windows");
  });

  it("does not call Edge and Opera 'Chrome' — both claim to be it", () => {
    const edge =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0";
    const opera =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/125.0.0.0";
    expect(browserLabel(edge)).toBe("Edge 141 on Windows");
    expect(browserLabel(opera)).toBe("Opera 125 on Windows");
  });

  it("does not call Safari 'Chrome' either", () => {
    expect(
      browserLabel(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
      ),
    ).toBe("Safari 18 on macOS");
  });

  it("recognises Firefox and the mobile platforms", () => {
    expect(browserLabel("Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0")).toBe(
      "Firefox 133 on Linux",
    );
    expect(
      browserLabel(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari 18 on iOS");
  });

  it("returns nothing rather than guessing, so the widget can omit the line", () => {
    expect(browserLabel("")).toBeUndefined();
    expect(browserLabel("curl/8.4.0")).toBeUndefined();
  });
});

describe("truncate", () => {
  it("collapses whitespace so a wrapped label stays one line", () => {
    expect(truncate("  Award   \n  item  ", 40)).toBe("Award item");
  });

  it("marks the cut, so a clipped selector is not read as a short one", () => {
    expect(truncate("abcdefghij", 5)).toBe("abcd…");
    expect(truncate("abcde", 5)).toBe("abcde");
  });
});

describe("contextLines", () => {
  it("omits every field the reporter did not supply", () => {
    expect(contextLines({ theme: "dark" })).toEqual([{ label: "Theme", value: "dark" }]);
  });

  it("orders element details before environment ones", () => {
    const lines = contextLines({
      elementLabel: 'button “Award item”',
      elementSelector: "main > table > button",
      viewport: "1512×945",
      theme: "light",
      browser: "Chrome 141 on Windows",
    });
    expect(lines.map((l) => l.label)).toEqual(["Element", "Path", "Window", "Theme", "Browser"]);
  });

  it("treats a context with nothing in it as empty", () => {
    expect(isEmptyContext({})).toBe(true);
    expect(isEmptyContext(undefined)).toBe(true);
    expect(isEmptyContext({ viewport: "800×600" })).toBe(false);
  });
});

describe("likelyRouteFile", () => {
  it("maps a static route to its App Router page", () => {
    expect(likelyRouteFile("/")).toBe("src/app/page.tsx");
    expect(likelyRouteFile("/roster")).toBe("src/app/roster/page.tsx");
    expect(likelyRouteFile("/admin/import")).toBe("src/app/admin/import/page.tsx");
  });

  it("collapses a segment carrying a value into a dynamic one", () => {
    // The real file is characters/[name]/performance — the point is to land in
    // the right folder, not to reproduce the parameter's name.
    expect(likelyRouteFile("/characters/Stiligwarr/performance")).toBe(
      "src/app/characters/[param]/performance/page.tsx",
    );
    expect(likelyRouteFile("/items/32497")).toBe("src/app/items/[param]/page.tsx");
  });
});

function report(overrides: Partial<FeedbackReport> = {}): FeedbackReport {
  return {
    id: "fb_1",
    kind: "bug",
    body: "Gold column reads 0 for everyone",
    route: "/logs",
    url: "http://localhost:3000/logs?report=abc123",
    status: "open",
    createdAt: "2026-08-07T12:32:00.000Z",
    ...overrides,
  };
}

describe("formatReportForAgent", () => {
  it("leads with the kind and carries everything needed to find the code", () => {
    const text = formatReportForAgent(
      report({
        reporter: "Aldric",
        context: {
          elementLabel: 'td “0g”',
          elementSelector: "main > table > tbody > tr:nth-of-type(3) > td",
          elementText: "0g",
          viewport: "1512×945",
          theme: "dark",
          browser: "Chrome 141 on Windows",
        },
      }),
    );
    expect(text).toContain("## Bug: Gold column reads 0 for everyone");
    expect(text).toContain("by Aldric");
    expect(text).toContain("`/logs` — likely `src/app/logs/page.tsx`");
    // The query string is usually the state that broke.
    expect(text).toContain("?report=abc123");
    expect(text).toContain("main > table > tbody > tr:nth-of-type(3) > td");
    expect(text).toContain("1512×945 · dark · Chrome 141 on Windows");
  });

  it("says plainly when the reporter shared no context", () => {
    const text = formatReportForAgent(report());
    expect(text).toContain("not shared by the reporter");
    expect(text).not.toContain("Environment");
  });

  it("titles a feedback report as feedback, not a bug", () => {
    expect(formatReportForAgent(report({ kind: "feedback", body: "Remember the sort order" }))).toContain(
      "## Feedback: Remember the sort order",
    );
  });

  it("keeps the reporter's words verbatim and last", () => {
    const body = "First line\n\nSecond paragraph with **markdown** in it";
    const text = formatReportForAgent(report({ body }));
    // The heading is truncated to one line; the body below is not.
    expect(text).toContain("## Bug: First line");
    expect(text.slice(text.indexOf("### What they wrote"))).toContain(body);
  });
});

describe("formatReportsForAgent", () => {
  it("bundles reports under one header, separated so they can't run together", () => {
    const text = formatReportsForAgent([report(), report({ id: "fb_2", kind: "feedback" })]);
    expect(text).toContain("# projectLC — 2 reports");
    expect(text.match(/^---$/gm)).toHaveLength(1);
  });

  it("returns nothing at all for an empty list", () => {
    expect(formatReportsForAgent([])).toBe("");
  });
});
