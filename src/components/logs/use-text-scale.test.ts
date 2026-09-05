import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SCALE_MAX,
  SCALE_MIN,
  SCALE_STEP,
  changeScale,
  readTextScale,
  resetTextScaleForTests,
  subscribeTextScale,
} from "@/components/logs/use-text-scale";

/**
 * The store behind the preparedness table's text-size control.
 *
 * The hook itself needs React and is not tested here; everything that can be
 * wrong is in the store under it, and all of it is about a browser that will
 * not cooperate. A reader who blocks site data still gets a working control
 * for the visit, a stored value from a previous version is clamped rather than
 * trusted, and the server's answer is 100% because it has no storage to read.
 */

/** A localStorage that is either a real map or a brick, like a real browser. */
function storage(initial?: string, blocked = false) {
  let value = initial;
  vi.stubGlobal("localStorage", {
    getItem: () => {
      if (blocked) throw new Error("storage blocked");
      return value ?? null;
    },
    setItem: (_key: string, next: string) => {
      if (blocked) throw new Error("storage blocked");
      value = next;
    },
  });
  return {
    get stored() {
      return value;
    },
  };
}

let saved: ReturnType<typeof storage>;

beforeEach(() => resetTextScaleForTests());
afterEach(() => vi.unstubAllGlobals());

describe("what a browser starts at", () => {
  it("is 100% when nothing was ever stored", () => {
    saved = storage();
    expect(readTextScale()).toBe(1);
  });

  it("is the stored size when there is one", () => {
    saved = storage("0.8");
    expect(readTextScale()).toBe(0.8);
  });

  it("is 100% when the stored value is nonsense", () => {
    // A hand-edited value, or a leftover from a version that stored something
    // else. Neither is worth rendering a table at.
    for (const junk of ["", "large", "0", "-1", "NaN"]) {
      resetTextScaleForTests();
      saved = storage(junk);
      expect(readTextScale(), junk).toBe(1);
    }
  });

  it("clamps a stored value that is outside the range the control offers", () => {
    resetTextScaleForTests();
    saved = storage("9");
    expect(readTextScale()).toBe(SCALE_MAX);

    resetTextScaleForTests();
    saved = storage("0.05");
    expect(readTextScale()).toBe(SCALE_MIN);
  });
});

describe("stepping", () => {
  it("moves by one step and remembers it", () => {
    saved = storage("1");
    changeScale(SCALE_STEP);
    expect(Number(saved.stored)).toBeCloseTo(1.1, 5);
    changeScale(-SCALE_STEP);
    expect(Number(saved.stored)).toBeCloseTo(1, 5);
  });

  it("stays on the tenths the control shows, rather than drifting", () => {
    // 0.1 + 0.2 arithmetic would render "70.00000000000001%" eventually. The
    // control displays a rounded percentage, so a store that drifts shows the
    // right number while saving a slightly wrong one.
    saved = storage("1");
    for (let i = 0; i < 4; i++) changeScale(-SCALE_STEP);
    expect(Number(saved.stored)).toBe(0.6);
  });

  it("stops at each end instead of running past it", () => {
    saved = storage("1");
    for (let i = 0; i < 20; i++) changeScale(SCALE_STEP);
    expect(Number(saved.stored)).toBe(SCALE_MAX);
    for (let i = 0; i < 40; i++) changeScale(-SCALE_STEP);
    expect(Number(saved.stored)).toBe(SCALE_MIN);
  });

  it("resets to 100% when asked for no step at all", () => {
    saved = storage("0.7");
    changeScale();
    expect(Number(saved.stored)).toBe(1);
  });
});

describe("a browser that blocks site data", () => {
  it("still applies a change, and does not throw doing it", () => {
    saved = storage(undefined, true);
    expect(() => changeScale(-SCALE_STEP)).not.toThrow();
    // Nothing was written, and nothing could be read — but the module-level
    // mirror is the whole store for this visit, so the control still works.
    expect(saved.stored).toBeUndefined();
  });

  it("still steps, and still tells its subscribers", () => {
    saved = storage(undefined, true);
    let told = 0;
    const stop = subscribeTextScale(() => told++);

    changeScale(-SCALE_STEP);
    expect(readTextScale()).toBeCloseTo(0.9, 5);
    expect(told).toBe(1);

    // And a listener that has gone away stops hearing about it, or a table
    // that has been unmounted keeps the store alive for the life of the tab.
    stop();
    changeScale(-SCALE_STEP);
    expect(told).toBe(1);
  });
});

describe("the range the control offers", () => {
  it("is a real range, and 100% sits inside it", () => {
    expect(SCALE_MIN).toBeLessThan(1);
    expect(SCALE_MAX).toBeGreaterThan(1);
    // A step that does not divide the range leaves an end unreachable, which
    // reads as a button that stops working before it is disabled.
    expect(Math.round((1 - SCALE_MIN) * 100) % Math.round(SCALE_STEP * 100)).toBe(0);
    expect(Math.round((SCALE_MAX - 1) * 100) % Math.round(SCALE_STEP * 100)).toBe(0);
  });
});
