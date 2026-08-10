import { describe, expect, it } from "vitest";
import {
  bandOf,
  buildRosterStanding,
  buildStandingBoard,
  type StandingInput,
} from "@/lib/analysis/standing";
import { DEFAULT_POLICY } from "@/lib/analysis/policy";
import type { AttendanceSummary, PerformanceSummary, RaiderMetrics } from "@/lib/types";

function attendance(pct: number, tracked = 20): AttendanceSummary {
  return {
    raidsTotal: tracked,
    raidsAttended: Math.round((pct / 100) * tracked),
    raidsTracked: tracked,
    raidPct: pct,
    recentAttended: 0,
    recentTotal: 10,
    recentPct: pct,
    pullsAttended: 0,
    pullsTotal: 0,
    pullPct: 0,
    weeks: [],
    weeksAttended: 0,
    weeksTracked: 0,
    weeksExcused: 0,
  };
}

function career(opts: { medianParse?: number; preparedPct?: number; fights?: number }): PerformanceSummary {
  return {
    fights: opts.fights ?? 40,
    kills: 30,
    wipes: 10,
    deaths: 2,
    medianParse: opts.medianParse,
    role: "dps",
    flaskOrElixirsPct: 100,
    flaskPct: 100,
    elixirsPct: 0,
    foodPct: 100,
    weaponBuffPct: 100,
    preparedPct: opts.preparedPct ?? 0,
    potionsTotal: 0,
    potionsPerFight: 0,
    prepots: 0,
    drums: 0,
    runes: 0,
    healthstones: 0,
    sappers: 0,
    missingEnchants: [],
  };
}

function raider(
  name: string,
  opts: { attendance?: number; parse?: number; prepared?: number; metrics?: RaiderMetrics } = {},
): StandingInput {
  return {
    characterId: `c-${name.toLowerCase()}`,
    name,
    status: "main",
    metrics:
      opts.metrics ??
      ({
        attendance: opts.attendance === undefined ? undefined : attendance(opts.attendance),
        career:
          opts.parse === undefined && opts.prepared === undefined
            ? undefined
            : career({ medianParse: opts.parse, preparedPct: opts.prepared }),
      } satisfies RaiderMetrics),
  };
}

const three = [
  raider("Bottom", { attendance: 40, parse: 20, prepared: 30 }),
  raider("Middle", { attendance: 70, parse: 55, prepared: 60 }),
  raider("Top", { attendance: 95, parse: 90, prepared: 99 }),
];

describe("buildStandingBoard", () => {
  it("puts the weakest raider first — the board answers a hard question", () => {
    const board = buildStandingBoard(three);
    expect(board.rows.map((r) => r.name)).toEqual(["Bottom", "Middle", "Top"]);
  });

  it("places a raider against the roster, not against a threshold", () => {
    // Nobody here would pass a "95% is good" bar, and that's the point: the
    // question is who is behind THIS guild, which moves as the guild moves.
    const board = buildStandingBoard([
      raider("A", { attendance: 30, parse: 10, prepared: 10 }),
      raider("B", { attendance: 40, parse: 20, prepared: 20 }),
    ]);
    expect(board.rows[1].standing).toBe(75); // top of a roster of two
    expect(board.rows[0].standing).toBe(25);
  });

  it("gives tied raiders the same placing rather than ordering them by accident", () => {
    const board = buildStandingBoard([
      raider("Same1", { attendance: 80, parse: 50, prepared: 50 }),
      raider("Same2", { attendance: 80, parse: 50, prepared: 50 }),
    ]);
    expect(board.rows[0].standing).toBe(board.rows[1].standing);
    expect(board.rows[0].standing).toBe(50);
  });

  it("drops a missing KPI out of the average instead of scoring it zero", () => {
    // No ranked kills is not a bad parse. Averaging in a zero would invent a
    // verdict out of an import gap.
    const noParse = buildStandingBoard([
      raider("NoParse", { attendance: 95, prepared: 99 }),
      raider("Full", { attendance: 40, parse: 90, prepared: 30 }),
    ]);
    const row = noParse.rows.find((r) => r.name === "NoParse")!;
    expect(row.measured).toBe(2);
    expect(row.kpis.find((k) => k.key === "performance")!.percentile).toBeUndefined();
    // Top of both KPIs they have — a missing third can't drag that down.
    expect(row.standing).toBe(75);
  });

  it("lists a raider with too few raids but refuses to place them", () => {
    const board = buildStandingBoard([
      ...three,
      raider("Trial", { attendance: 100, parse: 5, prepared: 5, metrics: {
        attendance: { ...attendance(100, 2), raidsAttended: 2, raidsTracked: 2 },
        career: career({ medianParse: 5, preparedPct: 5 }),
      } }),
    ]);
    const trial = board.rows.find((r) => r.name === "Trial")!;
    expect(trial.standing).toBeUndefined();
    expect(trial.unranked).toBe("only 2 logged raids");
    // Listed, and last — a question rather than an answer.
    expect(board.rows[board.rows.length - 1].name).toBe("Trial");
  });

  it("says nothing about a raider with nothing logged", () => {
    const board = buildStandingBoard([raider("Ghost")]);
    expect(board.rows[0].standing).toBeUndefined();
    expect(board.rows[0].measured).toBe(0);
  });

  it("follows the council's weighting", () => {
    // Attendance only: the raider who turns up wins regardless of parse.
    const attendanceOnly = {
      ...DEFAULT_POLICY,
      roster: { weights: { attendance: 100, performance: 0, preparation: 0 }, minRaids: 3 },
    };
    const board = buildStandingBoard(
      [
        raider("Reliable", { attendance: 95, parse: 10, prepared: 10 }),
        raider("Talented", { attendance: 40, parse: 95, prepared: 95 }),
      ],
      attendanceOnly,
    );
    expect(board.rows[0].name).toBe("Talented");
  });

  it("reports each KPI's shape so a useless one is visible", () => {
    // Everybody at 99 preparation: the KPI separates nobody, and the spread
    // says so without the app deciding what "too narrow" means.
    const board = buildStandingBoard([
      raider("A", { attendance: 20, parse: 10, prepared: 99 }),
      raider("B", { attendance: 90, parse: 95, prepared: 99 }),
      raider("C", { attendance: 60, prepared: 100 }),
    ]);
    const prep = board.distributions.find((d) => d.key === "preparation")!;
    expect(prep.spread).toBe(1);
    expect(prep.measured).toBe(3);

    const perf = board.distributions.find((d) => d.key === "performance")!;
    expect(perf.measured).toBe(2);
    expect(perf.missing).toBe(1);
    expect(perf.median).toBe(52.5);
  });

  it("doesn't call a lone raider best or worst", () => {
    const board = buildStandingBoard([raider("Only", { attendance: 50, parse: 50, prepared: 50 })]);
    expect(board.rows[0].standing).toBe(50);
  });

  it("keeps recent attendance beside the all-time figure without scoring it", () => {
    // A raider at 90% all-time and 20% lately is the conversation. Averaging
    // the two would hide precisely that.
    const metrics: RaiderMetrics = {
      attendance: { ...attendance(90), recentTotal: 10, recentAttended: 2, recentPct: 20 },
      career: career({ medianParse: 60, preparedPct: 60 }),
    };
    const board = buildStandingBoard([
      { characterId: "c-drift", name: "Drift", status: "main", metrics },
      raider("Steady", { attendance: 90, parse: 60, prepared: 60 }),
    ]);
    const drift = board.rows.find((r) => r.name === "Drift")!;
    expect(drift.recentAttendancePct).toBe(20);
    expect(drift.standing).toBe(board.rows.find((r) => r.name === "Steady")!.standing);
  });
});

describe("buildStandingBoard — who sets the scale", () => {
  it("draws the placings only from raiders it will actually place", () => {
    // Three trials at the bottom of the data would lift every regular's
    // percentile and flatter the whole roster. If we won't rank them, they
    // don't get to set the bar either.
    const trial = (name: string) => ({
      characterId: `c-${name}`,
      name,
      status: "main" as const,
      metrics: {
        attendance: { ...attendance(100, 1), raidsAttended: 1, raidsTracked: 1 },
        career: career({ medianParse: 1, preparedPct: 1 }),
      },
    });
    const withTrials = buildStandingBoard([...three, trial("T1"), trial("T2"), trial("T3")]);
    const alone = buildStandingBoard(three);

    expect(withTrials.pool).toBe(3);
    expect(withTrials.unplaced).toBe(3);
    for (const name of ["Bottom", "Middle", "Top"]) {
      expect(withTrials.rows.find((r) => r.name === name)!.standing).toBe(
        alone.rows.find((r) => r.name === name)!.standing,
      );
    }
    // And the distribution is the regulars' own, not dragged down by the trials.
    expect(withTrials.distributions.find((d) => d.key === "performance")!.min).toBe(20);
  });

  it("shows an unplaced raider's figures without giving them a placing", () => {
    const board = buildStandingBoard([
      ...three,
      {
        characterId: "c-trial",
        name: "Trial",
        status: "main",
        metrics: {
          attendance: { ...attendance(100, 2), raidsAttended: 2, raidsTracked: 2 },
          career: career({ medianParse: 88, preparedPct: 90 }),
        },
      },
    ]);
    const trial = board.rows.find((r) => r.name === "Trial")!;
    expect(trial.kpis.find((k) => k.key === "performance")!.value).toBe(88);
    expect(trial.kpis.find((k) => k.key === "performance")!.percentile).toBeUndefined();
    expect(trial.measured).toBe(3);
  });
});

describe("buildRosterStanding", () => {
  const main = (name: string, parse: number) => ({
    ...raider(name, { attendance: 80, parse, prepared: 80 }),
    status: "main" as const,
  });
  const alt = (name: string, parse: number) => ({
    ...raider(name, { attendance: 80, parse, prepared: 80 }),
    status: "alt" as const,
  });

  it("places mains against mains, and never lets an alt lift them", () => {
    // An alt raiding occasionally sits at the bottom of the data. Pooled, they
    // push every regular up and the guild reads healthier than it is.
    const pooled = buildStandingBoard([main("A", 40), main("B", 60), alt("Little", 5)]);
    const split = buildRosterStanding([main("A", 40), main("B", 60), alt("Little", 5)]);

    expect(pooled.rows.find((r) => r.name === "A")!.standing).toBeGreaterThan(
      split.mains.rows.find((r) => r.name === "A")!.standing!,
    );
    expect(split.mains.rows.map((r) => r.name)).toEqual(["A", "B"]);
    expect(split.mains.pool).toBe(2);
  });

  it("gives alts their own board rather than dropping them", () => {
    const split = buildRosterStanding([main("A", 40), alt("Little", 5), alt("Other", 90)]);
    expect(split.alts.rows.map((r) => r.name)).toEqual(["Little", "Other"]);
    // Placed among themselves, weakest first. They tie on attendance and
    // preparation here, so only parse separates them — the gap is real but
    // smaller than a bottom-and-top split would be.
    expect(split.alts.rows[0].standing!).toBeLessThan(split.alts.rows[1].standing!);
    expect(split.alts.pool).toBe(2);
  });

  it("keeps inactive raiders off the mains board", () => {
    const inactive = { ...raider("Gone", { attendance: 10, parse: 10, prepared: 10 }), status: "inactive" as const };
    const split = buildRosterStanding([main("A", 40), inactive]);
    expect(split.mains.rows.map((r) => r.name)).toEqual(["A"]);
    expect(split.alts.rows.map((r) => r.name)).toEqual(["Gone"]);
  });

  it("measures a trial against the mains, which is what a trial is", () => {
    // A board of trials on their own would rank them against each other and
    // answer nothing: the question is whether they hold up against the core.
    const trial = { ...raider("Newby", { attendance: 80, parse: 70, prepared: 80 }), status: "trial" as const };
    const split = buildRosterStanding([main("A", 40), main("B", 60), trial, alt("Little", 5)]);
    expect(split.mains.rows.map((r) => r.name).sort()).toEqual(["A", "B", "Newby"]);
    expect(split.alts.rows.map((r) => r.name)).toEqual(["Little"]);
  });
});

describe("bandOf", () => {
  it("names the quarter a placing falls in", () => {
    expect(bandOf(0)).toBe("bottom");
    expect(bandOf(24)).toBe("bottom");
    expect(bandOf(25)).toBe("lower");
    expect(bandOf(49)).toBe("lower");
    expect(bandOf(50)).toBe("upper");
    expect(bandOf(74)).toBe("upper");
    expect(bandOf(75)).toBe("top");
    expect(bandOf(100)).toBe("top");
  });

  it("rides along on every placed row", () => {
    const board = buildStandingBoard(three);
    expect(board.rows.map((r) => r.band)).toEqual(["bottom", "upper", "top"]);
    expect(board.rows.every((r) => (r.standing === undefined) === (r.band === undefined))).toBe(true);
  });
});
