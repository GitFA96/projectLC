import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEnchantName, resolveEnchantNames } from "@/lib/items/enchant-names";

/**
 * The one place the app talks to Warcraft DB.
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
let NAMED_ID = 0;

function stubFetch(answer: (id: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const id = Number(url.split("/").pop());
    // So `named()` can answer as the page for whichever id was asked — the
    // parser refuses a page whose id is not the one it asked about.
    NAMED_ID = id;
    return Promise.resolve(answer(id));
  });
  return calls;
}

/**
 * A page the way the real one answers: HTML carrying a schema.org block that
 * names the entity AND the id it is about.
 */
function page(id: number, name: string): Response {
  const graph = [
    { "@type": "WebSite", name: "Warcraft DB" },
    { "@type": "Thing", name, identifier: String(id), url: `https://tbc.warcraftdb.com/data/enchantment/${id}` },
  ];
  return new Response(
    `<html><head><title>${name} - TBC Anniversary - Warcraft DB</title>` +
      `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph })}</script>` +
      `</head><body>${name}</body></html>`,
    { status: 200 },
  );
}

const named = (name: string) => page(NAMED_ID, name);
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
      "https://tbc.warcraftdb.com/data/enchantment/2661",
      "https://tbc.warcraftdb.com/data/enchantment/1593",
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
    ["a page with no structured block", () => new Response("<html>ok</html>", { status: 200 })],
    ["a page whose name is blank", () => named("   ")],
    ["a block that is not JSON at all", () => new Response(
      '<script type="application/ld+json">{ nope </script>', { status: 200 })],
    [
      // The soft 404: a page that answers 200 and is about something else. The
      // name would render on a raider's gear panel forever, so the id has to
      // match or there is no name.
      "a page about a different id",
      (id: number) => page(id + 1, "+35 Agility"),
    ],
  ])("%s leaves the id unresolved", async (_label, answer) => {
    stubFetch(answer);
    const result = await resolveEnchantNames([2661], { pauseMs: 0 });
    expect(result).toEqual({ resolved: [], failed: [2661], throttled: false });
  });

  it("does not abandon the run — the next id is still tried", async () => {
    stubFetch((id) => (id === 2661 ? status(404) : page(id, "+15 Agility")));
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
    const calls = stubFetch((id) => (id === 1 ? page(id, "first") : status(code)));
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
  });

  it("gives up on a request that never answers, and moves on", async () => {
    vi.useFakeTimers();
    const asked: number[] = [];
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
      const id = Number(url.split("/").pop());
      asked.push(id);
      // The second id answers; the first hangs until its own signal aborts it,
      // which is the case the AbortController exists for.
      if (id === 2) return Promise.resolve(page(id, "answered"));
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
  });
});

/**
 * The parser, apart from the fetch.
 *
 * Worth its own cases because it is the whole defence against a wrong name: the
 * page is HTML written for people, and the name it yields is written into the
 * cache forever and shown on a raider's gear panel. Reading the title or the
 * breadcrumb would be shorter and would happily name an enchant off a redirect.
 */
describe("reading a name off the page", () => {
  const block = (obj: unknown) =>
    `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

  it("takes the name from the node whose identifier is the id asked about", () => {
    const html = block({
      "@graph": [
        { "@type": "Thing", name: "+15 Agility", identifier: "2564" },
        { "@type": "Thing", name: "+20 Spirit", identifier: "2567" },
      ],
    });
    expect(parseEnchantName(2567, html)).toBe("+20 Spirit");
  });

  it("accepts a numeric identifier as readily as a string one", () => {
    expect(parseEnchantName(2567, block({ "@graph": [{ name: "+20 Spirit", identifier: 2567 }] }))).toBe(
      "+20 Spirit",
    );
  });

  it("accepts a bare object, not only a @graph", () => {
    expect(parseEnchantName(2567, block({ name: "+20 Spirit", identifier: "2567" }))).toBe("+20 Spirit");
  });

  it("reads past a block it cannot parse rather than giving up on the page", () => {
    const html = `<script type="application/ld+json">{ not json </script>` +
      block({ "@graph": [{ name: "+20 Spirit", identifier: "2567" }] });
    expect(parseEnchantName(2567, html)).toBe("+20 Spirit");
  });

  it.each([
    ["no structured block at all", "<html><title>+20 Spirit</title></html>"],
    ["a block naming a different id", block({ "@graph": [{ name: "+20 Spirit", identifier: "9999" }] })],
    ["a node with no identifier", block({ "@graph": [{ name: "+20 Spirit" }] })],
    ["a name that is not a string", block({ "@graph": [{ name: 20, identifier: "2567" }] })],
    ["a blank name", block({ "@graph": [{ name: "   ", identifier: "2567" }] })],
  ])("yields nothing for %s", (_label, html) => {
    expect(parseEnchantName(2567, html)).toBeUndefined();
  });
});
