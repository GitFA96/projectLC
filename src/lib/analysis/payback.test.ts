import { describe, expect, it } from "vitest";
import {
  PAYBACK_FILE_KIND,
  PAYBACK_LIMITS,
  buildPayback,
  exportPayback,
  mergeImportedPayback,
  parsePaybackFile,
  type PaybackSpender,
} from "@/lib/analysis/payback";
import { ADJUSTMENTS_FILE_KIND } from "@/lib/analysis/consumable-adjustments";
import { DEFAULT_POLICY } from "@/lib/analysis/policy";

const spenders = (...gold: number[]): PaybackSpender[] =>
  gold.map((g, i) => ({ name: `R${String(i + 1).padStart(2, "0")}`, gold: g }));

/** The council's night: 30 marks at 100g, top 10 of 25 weighted double. */
const POT = { marks: 30, markGold: 100 };

describe("buildPayback — the pot", () => {
  it("splits exactly the pot, never a penny more", () => {
    // The whole reason this is an apportionment and not a rebate rate: the
    // guild can only hand back what it banked. Spends here are the real
    // night's, where the pot is a fifth of what the raid got through.
    const view = buildPayback({ spenders: spenders(1332, 1091, 1048, 995, 973), pot: POT });
    expect(view.pot.gold).toBe(3000);
    expect(Math.round(view.recommendedTotal)).toBe(3000);
    expect(view.undistributed).toBe(0);
    expect(view.rows.map((r) => r.share).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it("says nothing has been recorded rather than showing a table of zeros", () => {
    // "Nobody has entered what we banked" and "nobody is owed anything" are
    // different statements and the page has to be able to tell them apart.
    const view = buildPayback({ spenders: spenders(1332, 84), pot: { marks: 0, markGold: 0 } });
    expect(view.potRecorded).toBe(false);
    expect(view.recommendedTotal).toBe(0);
    // The ranking still stands — only the money is missing.
    expect(view.rows.map((r) => r.rank)).toEqual([1, 2]);
  });

  it("treats marks with no price as unrecorded", () => {
    // 30 marks at 0g is not a pot; it is half an entry.
    expect(buildPayback({ spenders: spenders(100), pot: { marks: 30, markGold: 0 } }).potRecorded)
      .toBe(false);
  });
});

describe("buildPayback — the weighting", () => {
  it("counts the top tier's spend double, not their payout", () => {
    // Two raiders, one in the tier and one out, on identical spend: the tier
    // takes two thirds. Doubling the WEIGHT is not doubling the gold, and the
    // difference matters as soon as the tier is more than one raider deep.
    const view = buildPayback({
      // A pot well under both raiders' spend, so the ceiling stays out of it.
      spenders: spenders(1000, 1000),
      pot: { marks: 3, markGold: 100 },
      policy: { ...DEFAULT_POLICY, payback: { topTier: 1, topWeight: 2 } },
    });
    expect(view.rows[0].share).toBeCloseTo(2 / 3, 10);
    expect(view.rows[1].share).toBeCloseTo(1 / 3, 10);
  });

  it("is a plain proportional split at weight 1", () => {
    // The escape hatch from the cliff, and the reason the weight is a knob:
    // set it to 1 and the tier stops meaning anything.
    const view = buildPayback({
      spenders: spenders(3000, 1000),
      pot: POT,
      policy: { ...DEFAULT_POLICY, payback: { topTier: 1, topWeight: 1 } },
    });
    expect(view.rows[0].share).toBeCloseTo(0.75, 10);
    expect(view.rows[1].share).toBeCloseTo(0.25, 10);
  });

  it("has a hard tier boundary, and it is visible", () => {
    // Documented rather than smoothed: on the real night ranks 10 and 11 were
    // 69g apart in spend. Whether that step is fair is the council's call, and
    // this test exists so nobody discovers it by accident.
    const view = buildPayback({
      spenders: spenders(...Array.from({ length: 12 }, (_, i) => 1000 - i)),
      pot: POT,
    });
    const tenth = view.rows[9];
    const eleventh = view.rows[10];
    expect(tenth.top).toBe(true);
    expect(eleventh.top).toBe(false);
    // Nine gold of spend between them, and nearly half the payback.
    expect(tenth.gold - eleventh.gold).toBe(1);
    expect(tenth.recommended).toBeGreaterThan(eleventh.recommended * 1.9);
  });

  it("boosts nobody when the tier is deeper than the roster", () => {
    const view = buildPayback({ spenders: spenders(3000, 1000), pot: POT });
    expect(view.rows.every((r) => r.top)).toBe(true);
    expect(view.rows[0].share).toBeCloseTo(0.75, 10);
  });
});

describe("buildPayback — the spend ceiling", () => {
  it("never pays anybody more than they spent, at any pot size", () => {
    // The rule, stated as a property rather than one example: no combination of
    // pot and weighting may produce a refund larger than the outlay, and the
    // column still adds up to whatever the ceiling allows.
    const night = spenders(1332, 1091, 1048, 995, 973, 930, 823, 799, 772, 678, 609, 84);
    const spendTotal = night.reduce((sum, s) => sum + s.gold, 0);
    for (let marks = 1; marks <= 200; marks += 7) {
      const view = buildPayback({ spenders: night, pot: { marks, markGold: 100 } });
      const potGold = marks * 100;
      for (const r of view.rows) {
        expect(r.recommended, `${r.name} over their spend at ${marks} marks`).toBeLessThanOrEqual(
          r.gold + 1e-9,
        );
        // And the mark column obeys the same ceiling the gold does.
        expect(r.marks * 100).toBeLessThanOrEqual(r.gold);
      }
      // Everything the ceiling allows is handed out — nothing evaporates.
      expect(Math.round(view.recommendedTotal)).toBe(Math.round(Math.min(potGold, spendTotal)));
      expect(view.marksAllocated).toBeLessThanOrEqual(marks);
    }
  });

  it("hands a capped raider's overflow back to everyone else", () => {
    // The failure this exists to prevent: clamping instead of redistributing
    // makes the column quietly add up to less than the raid banked, with
    // nothing on screen to say where the rest went.
    const view = buildPayback({
      spenders: spenders(1000, 1000, 200),
      pot: { marks: 20, markGold: 100 },
      policy: { ...DEFAULT_POLICY, payback: { topTier: 1, topWeight: 5 } },
    });
    const [first, second, third] = view.rows;
    expect(first.capped).toBe(true);
    expect(first.recommended).toBe(1000);
    // The 613g the boost would have overpaid goes to the other two, by weight.
    expect(Math.round(second.recommended)).toBe(833);
    expect(Math.round(third.recommended)).toBe(167);
    expect(Math.round(view.recommendedTotal)).toBe(2000);
    expect(view.undistributed).toBe(0);
  });

  it("reports what the ceiling makes undistributable rather than hiding it", () => {
    // A pot bigger than the night's spend cannot be paid out under this rule.
    // Absorbing it silently would leave the marks column disagreeing with the
    // number of marks the raid actually banked.
    const view = buildPayback({ spenders: spenders(500, 300), pot: { marks: 30, markGold: 100 } });
    expect(view.recommendedTotal).toBe(800);
    expect(view.undistributed).toBe(2200);
    expect(view.marksUndistributed).toBe(22);
    expect(view.rows.every((r) => r.capped)).toBe(true);
  });

  it("caps the mark column too, not only the gold", () => {
    // Marks are lumpy. A raider owed 150g against a 100g mark takes one; a
    // largest-remainder round-up would hand them 200g of marks while the gold
    // beside it said 150g.
    const view = buildPayback({
      spenders: [
        { name: "Aaa", gold: 683 },
        { name: "Bbb", gold: 150 },
      ],
      pot: { marks: 10, markGold: 100 },
    });
    const small = view.rows.find((r) => r.name === "Bbb")!;
    expect(small.recommended).toBe(150);
    expect(small.marks).toBe(1);
  });

  it("counts leftover marks apart from leftover gold", () => {
    // They are different facts: 683g of entitlement buys six marks and leaves
    // 83g on the table, because a seventh is worth more than that raider spent.
    const view = buildPayback({
      spenders: [
        { name: "Aaa", gold: 683 },
        { name: "Bbb", gold: 150 },
      ],
      pot: { marks: 10, markGold: 100 },
    });
    expect(view.marksAllocated).toBe(7);
    expect(view.marksUndistributed).toBe(3);
    // The gold figure is smaller, and that is not a contradiction.
    expect(view.undistributed).toBe(167);
  });
});

describe("buildPayback — whole marks", () => {
  it("hands out every mark and never invents one", () => {
    // A mark is a token; 2.7 of one cannot be given to anybody. Rounding each
    // share on its own would either over- or under-spend the pot with nothing
    // on screen to show which.
    const view = buildPayback({ spenders: spenders(1332, 1091, 1048, 995, 973), pot: POT });
    expect(view.marksAllocated).toBe(30);
    expect(view.rows.every((r) => Number.isInteger(r.marks))).toBe(true);
  });

  it("gives the leftovers to the largest remainders", () => {
    // Three equal spenders, ten marks: 3.33 each. Someone has to get the extra,
    // and it goes to the highest-ranked, not to whoever the sort happened to
    // put last.
    const view = buildPayback({
      spenders: [
        { name: "Aaa", gold: 1000 },
        { name: "Bbb", gold: 1000 },
        { name: "Ccc", gold: 1000 },
      ],
      pot: { marks: 10, markGold: 100 },
    });
    expect(view.rows.map((r) => r.marks)).toEqual([4, 3, 3]);
    expect(view.marksAllocated).toBe(10);
  });

  it("allocates none when no marks were banked", () => {
    const view = buildPayback({ spenders: spenders(100, 50), pot: { marks: 0, markGold: 100 } });
    expect(view.rows.every((r) => r.marks === 0)).toBe(true);
  });
});

describe("buildPayback — what officers recorded", () => {
  it("carries paid amounts through and totals them", () => {
    const view = buildPayback({
      spenders: spenders(13320, 10910),
      pot: POT,
      paid: { R01: 500, R02: 250 },
    });
    expect(view.rows.map((r) => r.paid)).toEqual([500, 250]);
    expect(view.paidTotal).toBe(750);
  });

  it("ignores a paid entry for somebody who isn't in the split", () => {
    // A raider whose pulls were all excluded, or a name that moved. The record
    // survives in storage; it just has no row to sit on.
    const view = buildPayback({ spenders: spenders(9000), pot: POT, paid: { Ghost: 900 } });
    expect(view.paidTotal).toBe(0);
  });

  it("leaves raiders who spent nothing out of the split entirely", () => {
    // Zero spend is zero share, and a row of zeroes in a payback table reads
    // as an accusation rather than an absence.
    const view = buildPayback({ spenders: spenders(10000, 0, 5000), pot: POT });
    expect(view.rows.map((r) => r.name)).toEqual(["R01", "R03"]);
  });
});

describe("exportPayback", () => {
  const at = "2026-09-07T18:00:00.000Z";

  it("names itself, the night it came from, and when it was written", () => {
    const file = exportPayback({
      code: "abc123",
      payback: { marks: 30, markGold: 100, paid: { Thrainn: 250 } },
      at,
    });
    expect(file.kind).toBe(PAYBACK_FILE_KIND);
    expect(file.version).toBe(1);
    expect(file.code).toBe("abc123");
    expect(file.exportedAt).toBe(at);
    expect(file.payback).toEqual({ marks: 30, markGold: 100, paid: { Thrainn: 250 } });
  });

  it("is not the corrections file, so the wrong pick is answerable", () => {
    expect(PAYBACK_FILE_KIND).not.toBe(ADJUSTMENTS_FILE_KIND);
  });

  it("copies the payouts rather than aliasing them", () => {
    const paid = { Thrainn: 250 };
    const file = exportPayback({ code: "abc123", payback: { marks: 30, markGold: 100, paid }, at });
    paid.Thrainn = 999;
    expect(file.payback.paid.Thrainn).toBe(250);
  });
});

describe("parsePaybackFile", () => {
  it("reads back exactly what it wrote", () => {
    const payback = { marks: 30, markGold: 100, paid: { Thrainn: 250, Pyrelia: 90 } };
    const file = exportPayback({ code: "abc123", payback, at: "2026-09-07T18:00:00.000Z" });
    const back = parsePaybackFile(JSON.parse(JSON.stringify(file)));
    expect(back).toEqual({ code: "abc123", marks: 30, markGold: 100, paid: payback.paid, skipped: 0 });
  });

  it("reads a bare record, so a pot assembled by hand works", () => {
    const back = parsePaybackFile({ marks: 12, markGold: 80, paid: {} });
    expect(back?.marks).toBe(12);
    expect(back?.code).toBeUndefined();
  });

  it("is null for anything that answers none of the three questions", () => {
    expect(parsePaybackFile(null)).toBeNull();
    expect(parsePaybackFile(42)).toBeNull();
    expect(parsePaybackFile([])).toBeNull();
    expect(parsePaybackFile({})).toBeNull();
    // The two other files exported from this same page.
    expect(parsePaybackFile({ "Super Mana Potion": { gold: 30, charges: 5 } })).toBeNull();
    expect(
      parsePaybackFile({
        kind: ADJUSTMENTS_FILE_KIND,
        adjustments: [{ actorName: "Thrainn", name: "Food", delta: 1, at: "x" }],
      }),
    ).toBeNull();
  });

  it("keeps absent apart from zero — the difference an import turns on", () => {
    const only = parsePaybackFile({ markGold: 120 });
    expect(only?.markGold).toBe(120);
    // Not `marks: 0`. The merge reads the absence as "the file didn't say".
    expect(only).not.toHaveProperty("marks");

    const zeroed = parsePaybackFile({ marks: 0, markGold: 120 });
    expect(zeroed?.marks).toBe(0);
  });

  it("drops a figure past its bound rather than clamping to it", () => {
    // Clamping would show the officer a number nobody recorded, as theirs.
    expect(parsePaybackFile({ marks: PAYBACK_LIMITS.marks + 1 })).not.toHaveProperty("marks");
    expect(parsePaybackFile({ marks: PAYBACK_LIMITS.marks })?.marks).toBe(PAYBACK_LIMITS.marks);
    expect(parsePaybackFile({ markGold: PAYBACK_LIMITS.markGold + 1 })).not.toHaveProperty(
      "markGold",
    );
    expect(parsePaybackFile({ markGold: -1 })).not.toHaveProperty("markGold");
    expect(parsePaybackFile({ marks: Number.NaN })).not.toHaveProperty("marks");
    expect(parsePaybackFile({ marks: "30" })).not.toHaveProperty("marks");
  });

  it("floors the marks, the way the panel floors what is typed into it", () => {
    expect(parsePaybackFile({ marks: 30.9 })?.marks).toBe(30);
  });

  it("skips payouts it cannot use, and counts them", () => {
    const back = parsePaybackFile({
      paid: {
        Thrainn: 250,
        Pyrelia: -5,
        Kazrak: "90",
        Gorlok: Number.POSITIVE_INFINITY,
        Ysolde: PAYBACK_LIMITS.paid + 1,
        "  ": 40,
        ["V".repeat(PAYBACK_LIMITS.paidName + 1)]: 40,
      },
    });
    expect(back?.paid).toEqual({ Thrainn: 250 });
    expect(back?.skipped).toBe(6);
  });

  it("drops a zero payout rather than carrying it as a value", () => {
    // An empty box already writes nothing; a stored 0 would read as an edit.
    const back = parsePaybackFile({ paid: { Thrainn: 0, Pyrelia: 10 } });
    expect(back?.paid).toEqual({ Pyrelia: 10 });
    expect(back?.skipped).toBe(0);
  });
});

describe("mergeImportedPayback", () => {
  const known = ["Thrainn", "Pyrelia"];
  const current = { marks: 30, markGold: 100, paid: { Thrainn: 250 } };

  it("re-importing a night's own export changes nothing", () => {
    const file = exportPayback({ code: "abc123", payback: current, at: "now" });
    const read = parsePaybackFile(JSON.parse(JSON.stringify(file)));
    const { payback, applied, absent, potChanged } = mergeImportedPayback({
      current,
      imported: read!,
      knownSpenders: known,
    });
    expect(payback).toEqual(current);
    expect(applied).toBe(1);
    expect(absent).toBe(0);
    expect(potChanged).toBe(false);
  });

  it("leaves the pot alone when the file is silent about it", () => {
    const { payback, potChanged } = mergeImportedPayback({
      current,
      imported: { paid: { Pyrelia: 40 } },
      knownSpenders: known,
    });
    expect(payback.marks).toBe(30);
    expect(payback.markGold).toBe(100);
    expect(potChanged).toBe(false);
    // And the payout it did name landed beside the one already there.
    expect(payback.paid).toEqual({ Thrainn: 250, Pyrelia: 40 });
  });

  it("carries a mark price onto a night that has none", () => {
    // The reason `code` is recorded but not enforced: what a mark is worth is
    // this week's reading of the economy, not a fact about one raid.
    const { payback, potChanged } = mergeImportedPayback({
      current: { marks: 0, markGold: 0, paid: {} },
      imported: { markGold: 120, paid: {} },
      knownSpenders: known,
    });
    expect(payback).toEqual({ marks: 0, markGold: 120, paid: {} });
    expect(potChanged).toBe(true);
  });

  it("replaces a payout rather than adding to it", () => {
    const { payback } = mergeImportedPayback({
      current,
      imported: { paid: { Thrainn: 90 } },
      knownSpenders: known,
    });
    expect(payback.paid.Thrainn).toBe(90);
  });

  it("never removes a payout the file is silent about", () => {
    const { payback, applied } = mergeImportedPayback({
      current,
      imported: { marks: 40, paid: {} },
      knownSpenders: known,
    });
    expect(payback.paid).toEqual({ Thrainn: 250 });
    expect(applied).toBe(0);
  });

  it("drops payouts for raiders this raid never had, and counts them", () => {
    const { payback, applied, absent } = mergeImportedPayback({
      current: { marks: 0, markGold: 0, paid: {} },
      imported: { paid: { Thrainn: 10, Gorlok: 20, Ysolde: 30 } },
      knownSpenders: known,
    });
    expect(payback.paid).toEqual({ Thrainn: 10 });
    expect(applied).toBe(1);
    expect(absent).toBe(2);
  });

  it("stores under the ranking's spelling, not the file's", () => {
    // `paid` is keyed by logged raider name and every reader looks it up by
    // that exact string — a row under "thrainn" is a row nothing reads.
    const { payback } = mergeImportedPayback({
      current: { marks: 0, markGold: 0, paid: {} },
      imported: { paid: { "  THRAINN ": 75 } },
      knownSpenders: known,
    });
    expect(payback.paid).toEqual({ Thrainn: 75 });
  });

  it("reports a moved pot so the officer is told what the file overwrote", () => {
    const { potChanged } = mergeImportedPayback({
      current,
      imported: { marks: 31, paid: {} },
      knownSpenders: known,
    });
    expect(potChanged).toBe(true);
  });
});
