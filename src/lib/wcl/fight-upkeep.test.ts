import { beforeEach, describe, expect, it, vi } from "vitest";

const wclQuery = vi.fn();
vi.mock("@/lib/wcl/client", () => ({ wclQuery: (...args: unknown[]) => wclQuery(...args) }));

const { fetchFightDebuffUptime } = await import("@/lib/wcl/fight-upkeep");

const ACTORS = [
  { id: 1, name: "Dëltâ", type: "Player", subType: "Warrior" },
  { id: 2, name: "Katzewarr", type: "Player", subType: "Warrior" },
  { id: 9, name: "Void Reaver", type: "NPC", subType: "Boss" },
  { id: 10, name: "Some Add", type: "NPC", subType: "NPC" },
  { id: 11, name: "Healer", type: "Player", subType: "Priest" },
];

/** Fight runs 1000 → 101000, i.e. 100 seconds. */
function reply(events: Record<string, unknown>[]) {
  return {
    reportData: {
      report: {
        fights: [{ startTime: 1000, endTime: 101_000 }],
        masterData: { actors: ACTORS },
        events: { data: events },
      },
    },
  };
}

const ev = (
  type: string,
  at: number,
  over: Partial<{ sourceID: number; targetID: number; ability: { name: string } }> = {},
) => ({
  type,
  timestamp: at,
  sourceID: 1,
  targetID: 9,
  ability: { name: "Deep Wounds" },
  ...over,
});

describe("fetchFightDebuffUptime", () => {
  beforeEach(() => {
    wclQuery.mockReset();
    // The module caches per (report, fight, abilities) forever, so each test
    // needs its own key — a logged fight never changes, which is why that's safe.
    vi.stubGlobal("__projectlcFightUpkeepCache", undefined);
  });

  it("measures a plain apply → remove window", async () => {
    wclQuery.mockResolvedValue(reply([ev("applydebuff", 11_000), ev("removedebuff", 51_000)]));
    const out = await fetchFightDebuffUptime("A", 1, ["Deep Wounds"]);
    expect(out).toEqual([{ source: "Dëltâ", ability: "Deep Wounds", pct: 40 }]);
  });

  it("runs an unclosed window to the end of the fight", async () => {
    // A debuff still ticking when the boss dies is up until the boss dies.
    wclQuery.mockResolvedValue(reply([ev("applydebuff", 51_000)]));
    const out = await fetchFightDebuffUptime("B", 1, ["Deep Wounds"]);
    expect(out[0].pct).toBe(50);
  });

  it("credits from the pull start when the first sighting is a removal", async () => {
    // Applied before the pull: the log's first mention is it falling off.
    wclQuery.mockResolvedValue(reply([ev("removedebuff", 21_000)]));
    const out = await fetchFightDebuffUptime("C", 1, ["Deep Wounds"]);
    expect(out[0].pct).toBe(20);
  });

  it("takes the best single target, never the sum", async () => {
    /*
     * The one that matters for a boss debuff. Adding an add's ten seconds to
     * the boss's forty would report 50% on a fight where the boss had 40 —
     * and on a trash-heavy pull it would sail past 100%.
     */
    wclQuery.mockResolvedValue(
      reply([
        ev("applydebuff", 11_000),
        ev("removedebuff", 51_000),
        ev("applydebuff", 11_000, { targetID: 10 }),
        ev("removedebuff", 21_000, { targetID: 10 }),
      ]),
    );
    const out = await fetchFightDebuffUptime("D", 1, ["Deep Wounds"]);
    expect(out).toHaveLength(1);
    expect(out[0].pct).toBe(40);
  });

  it("keeps each warrior's uptime apart", async () => {
    // Deep Wounds comes from a talent every warrior has, so an unattributed
    // total would credit the Fury warrior's bleed to the Arms one.
    wclQuery.mockResolvedValue(
      reply([
        ev("applydebuff", 1_000),
        ev("removedebuff", 91_000),
        ev("applydebuff", 41_000, { sourceID: 2 }),
        ev("removedebuff", 61_000, { sourceID: 2 }),
      ]),
    );
    const out = await fetchFightDebuffUptime("E", 1, ["Deep Wounds"]);
    expect(out).toEqual([
      { source: "Dëltâ", ability: "Deep Wounds", pct: 90 },
      { source: "Katzewarr", ability: "Deep Wounds", pct: 20 },
    ]);
  });

  it("ignores an NPC casting an ability of the same name", async () => {
    // Plenty of mobs have a "Rend". Counting one as a warrior's would invent
    // an Arms warrior's bleed out of boss melee.
    wclQuery.mockResolvedValue(
      reply([
        ev("applydebuff", 11_000, { sourceID: 9, targetID: 11, ability: { name: "Rend" } }),
        ev("removedebuff", 91_000, { sourceID: 9, targetID: 11, ability: { name: "Rend" } }),
      ]),
    );
    expect(await fetchFightDebuffUptime("F", 1, ["Rend"])).toEqual([]);
  });

  it("treats a refresh as keeping the window open", async () => {
    wclQuery.mockResolvedValue(
      reply([ev("applydebuff", 1_000), ev("refreshdebuff", 31_000), ev("removedebuff", 81_000)]),
    );
    expect((await fetchFightDebuffUptime("G", 1, ["Deep Wounds"]))[0].pct).toBe(80);
  });

  it("quotes ability names the way WCL's filter language needs", async () => {
    /*
     * Single quotes match NOTHING and raise no error, so the wrong quote reads
     * as "the raid never did this" — which is how a working query got mistaken
     * for proof that Blood Frenzy was absent.
     */
    wclQuery.mockResolvedValue(reply([]));
    await fetchFightDebuffUptime("H", 1, ["Deep Wounds", "Rend"]);
    expect(wclQuery.mock.calls[0][1]).toMatchObject({
      filter: 'ability.name IN ("Deep Wounds", "Rend")',
    });
  });

  it("asks nothing when given no ability names", async () => {
    expect(await fetchFightDebuffUptime("I", 1, [])).toEqual([]);
    expect(wclQuery).not.toHaveBeenCalled();
  });

  it("returns nothing when the fight isn't in the report", async () => {
    wclQuery.mockResolvedValue({
      reportData: { report: { fights: [], masterData: { actors: [] }, events: { data: [] } } },
    });
    expect(await fetchFightDebuffUptime("J", 1, ["Rend"])).toEqual([]);
  });
});
