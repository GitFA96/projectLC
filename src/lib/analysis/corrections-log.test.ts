import { describe, expect, it } from "vitest";
import {
  correctedRaiders,
  correctionAuthor,
  correctionsLog,
  filterByRaider,
  groupCorrections,
  type CorrectionEntry,
} from "@/lib/analysis/corrections-log";
import type { ConsumableAdjustment } from "@/lib/types";

const adj = (over: Partial<ConsumableAdjustment> = {}): ConsumableAdjustment => ({
  actorName: "Katzewarr",
  name: "Flask of Relentless Assault",
  delta: -1,
  at: "2026-08-10T12:00:00.000Z",
  ...over,
});

const REPORTS = [
  { code: "aaa", title: "SSC Tuesday", startedAt: "2026-08-04T19:00:00.000Z" },
  { code: "bbb", title: "TK Thursday", startedAt: "2026-08-06T19:00:00.000Z" },
];

describe("correctionsLog", () => {
  it("orders by when the correction was made, not the night it corrects", () => {
    // A correction to a three-week-old raid is news the day somebody makes it.
    const out = correctionsLog(
      {
        aaa: [adj({ at: "2026-08-12T10:00:00.000Z", name: "Old raid, new edit" })],
        bbb: [adj({ at: "2026-08-07T10:00:00.000Z", name: "New raid, old edit" })],
      },
      REPORTS,
    );
    expect(out.map((e) => e.name)).toEqual(["Old raid, new edit", "New raid, old edit"]);
  });

  it("carries the raid a correction belongs to", () => {
    const [entry] = correctionsLog({ aaa: [adj()] }, REPORTS);
    expect(entry.raid).toBe("SSC Tuesday");
    expect(entry.raidAt).toBe("2026-08-04T19:00:00.000Z");
  });

  it("keeps a correction whose report is gone", () => {
    // Reports get deleted and re-imported; a record of a judgement call that
    // vanishes with its report is not a record.
    const [entry] = correctionsLog({ zzz: [adj()] }, REPORTS);
    expect(entry.code).toBe("zzz");
    expect(entry.raid).toBeUndefined();
  });

  it("carries the author and the reason through", () => {
    const [entry] = correctionsLog(
      { aaa: [adj({ by: "Scomb", note: "drunk before the pull timer" })] },
      REPORTS,
    );
    expect(entry.by).toBe("Scomb");
    expect(entry.note).toBe("drunk before the pull timer");
  });
});

describe("filterByRaider", () => {
  const entries: CorrectionEntry[] = correctionsLog(
    { aaa: [adj(), adj({ actorName: "Wando" })] },
    REPORTS,
  );

  it("matches however the name was cased", () => {
    expect(filterByRaider(entries, "katzewarr")).toHaveLength(1);
    expect(filterByRaider(entries, "  WANDO ")).toHaveLength(1);
  });

  it("returns everything when nothing is asked for", () => {
    expect(filterByRaider(entries, undefined)).toHaveLength(2);
    expect(filterByRaider(entries, "   ")).toHaveLength(2);
  });
});

describe("correctedRaiders", () => {
  it("lists each raider once, sorted, in the spelling first seen", () => {
    const entries = correctionsLog(
      { aaa: [adj({ actorName: "Wando" }), adj({ actorName: "wando" }), adj()] },
      REPORTS,
    );
    expect(correctedRaiders(entries)).toEqual(["Katzewarr", "Wando"]);
  });
});

describe("correctionAuthor", () => {
  it("names the officer who made it", () => {
    expect(correctionAuthor({ by: "Scomb" })).toEqual({ name: "Scomb", known: true });
  });

  it("says Unknown for a correction made before attribution existed", () => {
    // A blank where a name belongs reads as an oversight; this is the honest
    // answer, and `known` is what lets the UI mark it as a gap in the record.
    expect(correctionAuthor({})).toEqual({ name: "Unknown", known: false });
    expect(correctionAuthor({ by: "   " })).toEqual({ name: "Unknown", known: false });
  });

  it("treats a signed-out officer as recorded, not unknown", () => {
    // `actingOfficer` writes "an officer" when nobody was signed in. That is a
    // value somebody wrote down, and the governance tab shows it as itself.
    expect(correctionAuthor({ by: "an officer" })).toEqual({ name: "an officer", known: true });
  });
});

describe("groupCorrections", () => {
  const at = "2026-08-12T10:00:00.000Z";
  const later = "2026-08-12T11:00:00.000Z";

  it("folds one save's corrections into a single chunk", () => {
    // A save stamps every entry it touched with the same `at`, so the batch is
    // recoverable without storing a batch id.
    const entries = correctionsLog(
      {
        aaa: [
          adj({ at, by: "Scomb", name: "Haste Potion" }),
          adj({ at, by: "Scomb", name: "Dark Rune" }),
          adj({ at, by: "Scomb", name: "Food" }),
        ],
      },
      REPORTS,
    );
    const [batch] = groupCorrections(entries);
    expect(groupCorrections(entries)).toHaveLength(1);
    expect(batch.entries).toHaveLength(3);
    expect(batch.by).toBe("Scomb");
  });

  it("keeps two officers' saves apart even at the same instant", () => {
    const entries = correctionsLog(
      { aaa: [adj({ at, by: "Scomb" }), adj({ at, by: "Wildmilky", name: "Dark Rune" })] },
      REPORTS,
    );
    expect(groupCorrections(entries)).toHaveLength(2);
  });

  it("keeps the same officer's two sittings apart", () => {
    const entries = correctionsLog(
      { aaa: [adj({ at, by: "Scomb" }), adj({ at: later, by: "Scomb", name: "Dark Rune" })] },
      REPORTS,
    );
    expect(groupCorrections(entries)).toHaveLength(2);
  });

  it("does not merge one officer's save across two raids", () => {
    const entries = correctionsLog(
      { aaa: [adj({ at, by: "Scomb" })], bbb: [adj({ at, by: "Scomb" })] },
      REPORTS,
    );
    expect(groupCorrections(entries)).toHaveLength(2);
  });

  it("counts what is on screen when the view is filtered", () => {
    const entries = correctionsLog(
      {
        aaa: [
          adj({ at, by: "Scomb" }),
          adj({ at, by: "Scomb", actorName: "Wando", name: "Dark Rune" }),
        ],
      },
      REPORTS,
    );
    const [batch] = groupCorrections(filterByRaider(entries, "Katzewarr"));
    expect(batch.entries).toHaveLength(1);
  });
});
