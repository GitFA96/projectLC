import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveEnchantNames } from "@/lib/items/enchant-names";

/**
 * The one place the app talks to wowclassicdb.
 *
 * Everything asserted here is about being a good guest on somebody else's free
 * API, because that is the part with no second chance: a backfill that bursts,
 * retries a 404 in a loop, or keeps hammering through a 429 gets the whole
 * deployment blocked, and the failure arrives as "enchants stopped resolving"
 * weeks later. The naming itself is one line and would be fine untested.
 *
 * `pauseMs: 0` in most cases below is only to keep the suite quick — the real
 * default pause has its own case, with fake timers, at the bottom.
 */

interface Call {
  url: string;
  init: RequestInit;
}

/** A fetch that answers from a table of ids, and records what it was asked. */
function stubFetch(answer: (id: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const id = Number(url.split("/").pop());
    return Promise.resolve(answer(id));
  });
  return calls;
}

const named = (name: string) => new Response(JSON.stringify({ name }), { status: 200 });
const status = (code: number) => new Response("", { status: code });

const idsAsked = (calls: Call[]) => calls.map((c) => Number(c.url.split("/").pop()));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("naming an enchant", () => {
  it("returns the name the database gives, against the id that was asked", async () => {
    stubFetch(() => named("+35 Agility"));
    const result = await resolveEnchantNames([2661], { pauseMs: 0 });
    expect(result).toEqual({ resolved: [{ id: 2661, name: "+35 Agility" }], failed: [], throttled: false });
  });

  it("trims the name, because the source is somebody else's data", async () => {
    stubFetch(() => named("  Glove Reinforcements  "));
    const { resolved } = await resolveEnchantNames([2937], { pauseMs: 0 });
    expect(resolved[0].name).toBe("Glove Reinforcements");
  });

  it("asks the TBC enchantment endpoint, once per id", async () => {
    const calls = stubFetch(() => named("x"));
    await resolveEnchantNames([2661, 1593], { pauseMs: 0 });
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.wowclassicdb.com/tbc/enchantment/2661",
      "https://api.wowclassicdb.com/tbc/enchantment/1593",
    ]);
  });

  it("identifies itself and refuses a cached answer", async () => {
    const calls = stubFetch(() => named("x"));
    await resolveEnchantNames([2661], { pauseMs: 0 });
    expect(calls[0].init.headers).toMatchObject({ "User-Agent": "projectlc-guild-tracker" });
    expect(calls[0].init.cache).toBe("no-store");
  });
});

describe("an id the database has nothing for", () => {
  // Every one of these means "there is no name here". None of them mean "ask
  // again" — an id that failed comes back as an id, and the next press picks
  // up the ids that have not been tried, not the ones that have.
  it.each([
    ["a 404", () => status(404)],
    ["a 500", () => status(500)],
    ["an answer with no name field", () => new Response("{}", { status: 200 })],
    ["an answer whose name is blank", () => named("   ")],
    ["a body that is not JSON at all", () => new Response("<html>", { status: 200 })],
  ])("%s leaves the id unresolved", async (_label, answer) => {
    stubFetch(answer);
    const result = await resolveEnchantNames([2661], { pauseMs: 0 });
    expect(result).toEqual({ resolved: [], failed: [2661], throttled: false });
  });

  it("does not abandon the run — the next id is still tried", async () => {
    stubFetch((id) => (id === 2661 ? status(404) : named("+15 Agility")));
    const result = await resolveEnchantNames([2661, 2564], { pauseMs: 0 });
    expect(result.failed).toEqual([2661]);
    expect(result.resolved).toEqual([{ id: 2564, name: "+15 Agility" }]);
  });

  it("survives the network being down", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("ENOTFOUND")));
    const result = await resolveEnchantNames([2661], { pauseMs: 0 });
    expect(result).toEqual({ resolved: [], failed: [2661], throttled: false });
  });
});

describe("being turned away", () => {
  it.each([429, 403])("stops the whole run on a %i", async (code) => {
    const calls = stubFetch((id) => (id === 1 ? named("first") : status(code)));
    const result = await resolveEnchantNames([1, 2, 3, 4], { pauseMs: 0 });

    // The distinction that matters: what came back before the refusal is kept
    // and saved, the refused id is NOT filed as failed (it was never answered
    // for), and nothing after it is asked at all.
    expect(result.resolved).toEqual([{ id: 1, name: "first" }]);
    expect(result.failed).toEqual([]);
    expect(result.throttled).toBe(true);
    expect(idsAsked(calls)).toEqual([1, 2]);
  });
});

describe("what one run is allowed to ask for", () => {
  it("caps a run at sixty ids by default, and leaves the rest", async () => {
    const calls = stubFetch(() => named("x"));
    const ids = Array.from({ length: 200 }, (_, i) => i + 1);
    const { resolved } = await resolveEnchantNames(ids, { pauseMs: 0 });
    expect(calls).toHaveLength(60);
    expect(resolved).toHaveLength(60);
  });

  it("takes the cap from the front, so the next press continues rather than repeats", async () => {
    const calls = stubFetch(() => named("x"));
    await resolveEnchantNames([10, 20, 30, 40], { limit: 2, pauseMs: 0 });
    expect(idsAsked(calls)).toEqual([10, 20]);
  });

  it("asks once for an id listed twice", async () => {
    const calls = stubFetch(() => named("x"));
    await resolveEnchantNames([2661, 2661, 1593, 2661], { pauseMs: 0 });
    expect(idsAsked(calls)).toEqual([2661, 1593]);
  });

  it("never asks about an id that cannot be one", async () => {
    // Zero is what an unenchanted slot reports, and it is the id most likely to
    // arrive in bulk — a raid of unenchanted boots would otherwise spend the
    // whole run's budget asking about nothing.
    const calls = stubFetch(() => named("x"));
    const result = await resolveEnchantNames([0, -1, 1.5, Number.NaN], { pauseMs: 0 });
    expect(calls).toHaveLength(0);
    expect(result).toEqual({ resolved: [], failed: [], throttled: false });
  });

  it("does nothing, quietly, when asked for nothing", async () => {
    const calls = stubFetch(() => named("x"));
    expect(await resolveEnchantNames([], { pauseMs: 0 })).toEqual({
      resolved: [],
      failed: [],
      throttled: false,
    });
    expect(calls).toHaveLength(0);
  });
});

describe("the trickle", () => {
  it("pauses between requests, and not before the first", async () => {
    vi.useFakeTimers();
    const calls = stubFetch(() => named("x"));

    const run = resolveEnchantNames([1, 2, 3], { pauseMs: 150 });
    await vi.advanceTimersByTimeAsync(0);
    expect(idsAsked(calls)).toEqual([1]);

    await vi.advanceTimersByTimeAsync(149);
    expect(idsAsked(calls), "asked again before the pause was up").toEqual([1]);

    await vi.advanceTimersByTimeAsync(1);
    expect(idsAsked(calls)).toEqual([1, 2]);

    await vi.advanceTimersByTimeAsync(150);
    expect((await run).resolved).toHaveLength(3);
    // Generous, and deliberately so: nothing here waits on wall-clock time, so
    // the only thing the default five seconds could ever measure is how loaded
    // the machine is.
  }, 20_000);

  it("gives up on a request that never answers, and moves on", async () => {
    vi.useFakeTimers();
    const asked: number[] = [];
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
      const id = Number(url.split("/").pop());
      asked.push(id);
      // The second id answers; the first hangs until its own signal aborts it,
      // which is the case the AbortController exists for.
      if (id === 2) return Promise.resolve(named("answered"));
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });

    const run = resolveEnchantNames([1, 2], { pauseMs: 0, timeoutMs: 8000 });
    await vi.advanceTimersByTimeAsync(7999);
    expect(asked).toEqual([1]);

    await vi.advanceTimersByTimeAsync(1);
    // The pause before the second id is a timer too, even at `pauseMs: 0`.
    await vi.runAllTimersAsync();
    const result = await run;
    expect(result.failed).toEqual([1]);
    expect(result.resolved).toEqual([{ id: 2, name: "answered" }]);
  }, 20_000);
});
