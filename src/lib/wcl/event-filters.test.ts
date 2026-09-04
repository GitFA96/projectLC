import { describe, expect, it } from "vitest";
import {
  BUFFS_FILTER,
  CASTS_FILTER,
  DEBUFFS_FILTER,
  UNFILTERED_ON_PURPOSE,
  buildEventFilter,
} from "@/lib/wcl/event-filters";
import {
  ELIXIR_BUFF_IDS,
  ELIXIR_BUFF_NAMES,
  FLASK_BUFF_IDS,
  PET_BUFF_IDS,
  SAPPER_CAST_NAMES,
  SCROLL_BUFF_IDS,
  SCROLL_CAST_IDS,
  TRACKED_CAST_IDS,
} from "@/lib/wcl/consumables";
import {
  APPLY_CAST_NAMES,
  BUFF_TRACK_NAMES,
  COOLDOWN_CAST_IDS,
  DEBUFF_TRACK_NAMES,
  SHAMAN_TOTEM_CASTS,
} from "@/lib/wcl/class-tracks";

/**
 * The filters decide what a report import can ever contain.
 *
 * `docs.test.ts` used to grep `fetch-report.ts` for the names of these lists,
 * which is a weaker claim than it looks: an import that is present but no
 * longer reaches the expression passes it. These check the built string.
 *
 * The failure being guarded is chains §1's: a curated id that never reaches the
 * filter means the event is never fetched, which means every report says zero
 * uses for ever — with nothing failing, nothing logged, and a diff that reviews
 * as correct.
 */

/**
 * The ids and names a built expression actually asks Warcraft Logs for.
 *
 * Names are read as every quoted run rather than by slicing the `IN (…)` — a
 * curated name can contain brackets of its own ("Faerie Fire (Feral)"), and a
 * parser that stops at the first `)` loses everything after it. Ids never
 * contain either character, so the simpler match is safe for those.
 */
const idsIn = (filter: string) =>
  new Set((/ability\.id IN \(([^)]*)\)/.exec(filter)?.[1] ?? "").split(", ").filter(Boolean));
const namesIn = (filter: string) => new Set(filter.match(/"[^"]*"/g) ?? []);

describe("buildEventFilter", () => {
  it("writes both clauses in WCL's own syntax", () => {
    expect(buildEventFilter({ ids: [[1, 2]], names: [["Bloodlust"]] })).toBe(
      'ability.id IN (1, 2) OR ability.name IN ("Bloodlust")',
    );
  });

  it("double-quotes every name", () => {
    // The chains §1 trap. Unquoted, WCL reads the name as an identifier and the
    // whole expression errors at import time — or worse, silently matches less.
    const filter = buildEventFilter({ names: [["Battle Shout", "Sunder Armor"]] });
    expect(filter).toBe('ability.name IN ("Battle Shout", "Sunder Armor")');
    for (const name of ["Battle Shout", "Sunder Armor"]) {
      expect(filter).toContain(`"${name}"`);
    }
  });

  it("emits only the clause it has values for", () => {
    expect(buildEventFilter({ ids: [[7]] })).toBe("ability.id IN (7)");
    expect(buildEventFilter({ names: [["Innervate"]] })).toBe('ability.name IN ("Innervate")');
  });

  it("takes sets, arrays and map keys alike, and merges them in order", () => {
    // The curated lists are all three shapes, and several overlap on purpose.
    const filter = buildEventFilter({
      ids: [new Set([3, 1]), [1, 2], new Map([[9, "x"]]).keys()],
      names: [["A"], ["A", "B"]],
    });
    expect(filter).toBe('ability.id IN (3, 1, 2, 9) OR ability.name IN ("A", "B")');
  });

  it("refuses to build a filter out of nothing", () => {
    // The important direction. An expression built from empty lists either
    // matches no events or asks for the whole log; the first is indistinguishable
    // from a raid where nobody used a consumable, and it would persist into
    // every report imported afterwards. Failing at import is the only loud
    // option available.
    expect(() => buildEventFilter({})).toThrow(/built from nothing/);
    expect(() => buildEventFilter({ ids: [[]], names: [[]] })).toThrow(/built from nothing/);
  });

  it("refuses a name it cannot quote", () => {
    expect(() => buildEventFilter({ names: [['Say "Hello"']] })).toThrow(/double quote/);
  });
});

describe("the filters the import actually sends", () => {
  it("asks for every curated cast list", () => {
    const ids = idsIn(CASTS_FILTER);
    for (const [label, list] of [
      ["TRACKED_CAST_IDS", TRACKED_CAST_IDS],
      ["SCROLL_CAST_IDS", SCROLL_CAST_IDS],
      ["COOLDOWN_CAST_IDS", COOLDOWN_CAST_IDS],
    ] as const) {
      expect([...list].length, `${label} is empty`).toBeGreaterThan(0);
      for (const id of list) expect(ids, `${label} lost ${id}`).toContain(String(id));
    }

    const names = namesIn(CASTS_FILTER);
    for (const [label, list] of [
      ["SAPPER_CAST_NAMES", SAPPER_CAST_NAMES],
      ["SHAMAN_TOTEM_CASTS", SHAMAN_TOTEM_CASTS],
      ["APPLY_CAST_NAMES", APPLY_CAST_NAMES],
    ] as const) {
      expect([...list].length, `${label} is empty`).toBeGreaterThan(0);
      for (const name of list) expect(names, `${label} lost ${name}`).toContain(`"${name}"`);
    }
  });

  it("carries Devastate, the cast nobody expects", () => {
    // chains §1: it is how a protection warrior stacks Sunder, it applies the
    // aura under its own cast name, and without it in the CAST filter the aura
    // matcher finds nothing and falls back to the log's own attribution — which
    // credits every sunder to whoever opened the window.
    expect(namesIn(CASTS_FILTER)).toContain('"Devastate"');
  });

  it("asks for every tracked debuff by name", () => {
    expect(DEBUFF_TRACK_NAMES.length).toBeGreaterThan(0);
    const names = namesIn(DEBUFFS_FILTER);
    for (const name of DEBUFF_TRACK_NAMES) expect(names).toContain(`"${name}"`);
    // Ids would be wrong here: a track matches by NAME so one entry covers
    // every rank of the spell.
    expect(idsIn(DEBUFFS_FILTER).size).toBe(0);
  });

  it("carries the four id sets no combatantinfo snapshot can", () => {
    const ids = idsIn(BUFFS_FILTER);
    for (const [label, list] of [
      ["FLASK_BUFF_IDS", FLASK_BUFF_IDS],
      ["SCROLL_BUFF_IDS", SCROLL_BUFF_IDS],
      ["PET_BUFF_IDS", PET_BUFF_IDS],
      ["ELIXIR_BUFF_IDS", ELIXIR_BUFF_IDS],
    ] as const) {
      expect(list.size, `${label} is empty`).toBeGreaterThan(0);
      for (const id of list.keys()) expect(ids, `${label} lost ${id}`).toContain(String(id));
    }

    const names = namesIn(BUFFS_FILTER);
    for (const name of [...BUFF_TRACK_NAMES, ...ELIXIR_BUFF_NAMES]) {
      expect(names).toContain(`"${name}"`);
    }
  });

  it("names the three streams that stay unfiltered", () => {
    // Each entry carries its argument. The list is short and is meant to stay
    // that way: adding a stream here is a decision to pay for the whole thing.
    expect(Object.keys(UNFILTERED_ON_PURPOSE).sort()).toEqual([
      "Dispels",
      "EnemyCasts",
      "Interrupts",
    ]);
    for (const [stream, why] of Object.entries(UNFILTERED_ON_PURPOSE)) {
      expect(why.length, `${stream} has no argument for being unfiltered`).toBeGreaterThan(20);
    }
  });
});
