import { beforeEach, describe, expect, it, vi } from "vitest";

const wclQuery = vi.fn();
vi.mock("@/lib/wcl/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/wcl/client")>()),
  wclQuery: (...args: unknown[]) => wclQuery(...args),
}));

const { resolveFightActor } = await import("@/lib/wcl/fight-graph");

const GOOD = {
  reportData: {
    report: {
      masterData: {
        actors: [{ id: 26, name: "Katzewarr", type: "Player", subType: "Warrior" }],
        abilities: [{ gameID: 30335, name: "Bloodthirst" }],
      },
      fights: [{ id: 63, name: "Void Reaver", kill: true, startTime: 7_438_509, endTime: 7_579_925 }],
    },
  },
};

/** What WCL hands back under load: parseable, and missing everything. */
const DEGRADED = { reportData: { report: null } };
const EMPTY_FIGHTS = { reportData: { report: { masterData: { actors: [] }, fights: [] } } };

describe("fetchOverview never caches a degraded response", () => {
  beforeEach(() => {
    wclQuery.mockReset();
    // The overview cache lives on globalThis and is keyed by report code, so
    // each test needs its own code rather than a cache reset.
  });

  it("resolves a fight from a healthy report", async () => {
    wclQuery.mockResolvedValue(GOOD);
    const at = await resolveFightActor("HEALTHY01", 63, "Katzewarr");
    expect(at).toMatchObject({ actorId: 26, encounterName: "Void Reaver", durationMs: 141_416 });
  });

  it("reports a null report as a failed fetch, not as a missing fight", async () => {
    /*
     * The bug this exists for. Every field in the overview schema is nullish,
     * so `report: null` PARSES — it used to be cached, and every later lookup
     * then said "Fight 63 was not found in report X" about a fight that plainly
     * exists, until the server was restarted.
     */
    wclQuery.mockResolvedValue(DEGRADED);
    await expect(resolveFightActor("DEGRADED1", 63, "Katzewarr")).rejects.toThrow(/no fights/i);
  });

  it("treats an empty fight list the same way", async () => {
    wclQuery.mockResolvedValue(EMPTY_FIGHTS);
    await expect(resolveFightActor("DEGRADED2", 63, "Katzewarr")).rejects.toThrow(/try again/i);
  });

  it("recovers on the next attempt instead of staying broken", async () => {
    // The whole point: a transient failure must not outlive itself.
    wclQuery.mockResolvedValueOnce(DEGRADED).mockResolvedValue(GOOD);
    await expect(resolveFightActor("RECOVER01", 63, "Katzewarr")).rejects.toThrow();
    await expect(resolveFightActor("RECOVER01", 63, "Katzewarr")).resolves.toMatchObject({
      actorId: 26,
    });
  });

  it("still fetches only once for a healthy report", async () => {
    wclQuery.mockResolvedValue(GOOD);
    await resolveFightActor("CACHED001", 63, "Katzewarr");
    await resolveFightActor("CACHED001", 63, "Katzewarr");
    expect(wclQuery).toHaveBeenCalledTimes(1);
  });

  it("says the log was re-uploaded when the fight really is gone", async () => {
    // A report that renumbers its fights is the one case where "not found" is
    // the truth — and the message has to say what to do about it.
    wclQuery.mockResolvedValue(GOOD);
    await expect(resolveFightActor("RENUM0001", 99, "Katzewarr")).rejects.toThrow(/re-uploaded/i);
  });

  it("names the player it couldn't find", async () => {
    wclQuery.mockResolvedValue(GOOD);
    await expect(resolveFightActor("MISSING01", 63, "Nobody")).rejects.toThrow(/"Nobody"/);
  });
});
