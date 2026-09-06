import { beforeEach, describe, expect, it } from "vitest";
import {
  answers,
  arm,
  disarm,
  interceptedHref,
  nextAfter,
  resetArmedForTests,
  type ArmedPanel,
  type ClickFacts,
} from "@/components/unsaved-navigation";

/**
 * The guard that stands between an officer's unsaved corrections and a click.
 *
 * What makes this worth testing is the direction of the failures. A guard that
 * intercepts too much is visible immediately — a dialog over a link that was
 * never going to lose anything, and somebody complains the same day. A guard
 * that intercepts too *little* loses a raid night's consumable corrections and
 * says nothing at all: the page navigates, the work is gone, and there is
 * nothing to notice. Every refusal below is therefore a case.
 *
 * The turn-taking half is the same shape. Two panels on the logs page can hold
 * unsaved work at once, and the failure is not two dialogs — it is one dialog
 * that speaks for both and discards the panel it never mentioned.
 */

const HERE = "https://lc.example/logs?code=ABC";

function click(over: Partial<ClickFacts> = {}): ClickFacts {
  return {
    defaultPrevented: false,
    button: 0,
    modified: false,
    anchor: { href: "https://lc.example/roster", download: false, target: "" },
    ...over,
  };
}

describe("which clicks are the guard's business", () => {
  it("catches an ordinary click on an in-app link", () => {
    expect(interceptedHref(click(), HERE)).toBe("/roster");
  });

  it("keeps the query and the hash of where it was going", () => {
    // The dialog navigates here later, so anything dropped now is dropped for
    // good — a filtered view or an anchor the officer had picked.
    const anchor = { href: "https://lc.example/loot?zone=SSC#thori", download: false, target: "" };
    expect(interceptedHref(click({ anchor }), HERE)).toBe("/loot?zone=SSC#thori");
  });

  it("catches a click on something inside the link", () => {
    // The hook resolves `closest("a[href]")` before asking, so by the time the
    // decision is made a click on a span in a link is a click on the link.
    expect(interceptedHref(click(), HERE)).toBe("/roster");
    expect(interceptedHref(click({ anchor: null }), HERE)).toBeNull();
  });

  it("leaves alone a click that was never going to navigate this tab", () => {
    expect(interceptedHref(click({ defaultPrevented: true }), HERE), "already handled").toBeNull();
    expect(interceptedHref(click({ button: 1 }), HERE), "middle button").toBeNull();
    expect(interceptedHref(click({ button: 2 }), HERE), "right button").toBeNull();
    expect(interceptedHref(click({ modified: true }), HERE), "opens a new tab").toBeNull();
  });

  it("leaves alone a download and a named target", () => {
    // Neither unmounts the page, so there is nothing to lose and a dialog would
    // be a lie about what the click was doing.
    const download = { href: "https://lc.example/export.csv", download: true, target: "" };
    expect(interceptedHref(click({ anchor: download }), HERE)).toBeNull();
    const newWindow = { href: "https://lc.example/roster", download: false, target: "_blank" };
    expect(interceptedHref(click({ anchor: newWindow }), HERE)).toBeNull();
    // `_self` is this document, and is the same as saying nothing.
    const self = { href: "https://lc.example/roster", download: false, target: "_self" };
    expect(interceptedHref(click({ anchor: self }), HERE)).toBe("/roster");
  });

  it("leaves an external link to beforeunload", () => {
    // It unloads the document, so the browser's own dialog has it — and that
    // one cannot be talked out of. Catching it here would stack two.
    const away = { href: "https://warcraftlogs.com/reports/ABC", download: false, target: "" };
    expect(interceptedHref(click({ anchor: away }), HERE)).toBeNull();
  });

  it("leaves a bare hash on the page you are already on", () => {
    // Nothing unmounts, so nothing is lost. A dialog here asks about a scroll.
    const hash = { href: "https://lc.example/logs?code=ABC#gold", download: false, target: "" };
    expect(interceptedHref(click({ anchor: hash }), HERE)).toBeNull();
  });

  it("catches a change of query on the same path", () => {
    // The opposite case, and the one that matters on the logs page: switching
    // report re-renders every panel on it.
    const other = { href: "https://lc.example/logs?code=XYZ", download: false, target: "" };
    expect(interceptedHref(click({ anchor: other }), HERE)).toBe("/logs?code=XYZ");
  });

  it("resolves a relative href against the page", () => {
    // A real anchor's `.href` comes back already resolved, so this is belt and
    // braces — but the function takes a string, and a caller handing it the
    // literal attribute should get the same answer.
    const relative = { href: "../roster", download: false, target: "" };
    expect(interceptedHref(click({ anchor: relative }), HERE)).toBe("/roster");
  });

  it("refuses rather than throws when it cannot make sense of the page", () => {
    /*
     * This runs inside a capture-phase click handler: a throw here does not
     * fail one navigation, it breaks every click on the page and leaves no
     * dialog behind to say why. So the answer to nonsense is "not mine".
     *
     * Only a bad *base* can reach the catch — an anchor href that looks like
     * nonsense simply resolves as a relative path, which the case above shows.
     */
    expect(interceptedHref(click(), "::not a url::")).toBeNull();
    expect(() => interceptedHref(click(), "")).not.toThrow();
  });
});

describe("whose turn it is", () => {
  const asked: string[] = [];
  const panel = (name: string): ArmedPanel => ({ ask: (href) => asked.push(`${name}:${href}`) });

  beforeEach(() => {
    resetArmedForTests();
    asked.length = 0;
  });

  it("gives the click to whoever armed first", () => {
    const prices = panel("prices");
    const gold = panel("gold");
    arm(prices);
    arm(gold);
    expect(answers(prices)).toBe(true);
    // Otherwise both open a dialog over the same click.
    expect(answers(gold)).toBe(false);
  });

  it("passes the destination to the next panel still holding work", () => {
    const prices = panel("prices");
    const gold = panel("gold");
    arm(prices);
    arm(gold);
    // `prices` has just saved and is leaving. Its own entry may not be torn
    // down yet — the effect cleans up after the commit that cleared `when`.
    expect(nextAfter(prices)).toBe(gold);
    nextAfter(prices)?.ask("/roster");
    expect(asked).toEqual(["gold:/roster"]);
  });

  it("never hands a panel its own destination", () => {
    // The window this guards: `prices` is still in the set while its dialog
    // runs. Skipping by identity rather than assuming it is gone is what stops
    // it asking itself and hanging on its own dialog.
    const prices = panel("prices");
    arm(prices);
    expect(nextAfter(prices)).toBeUndefined();
  });

  it("says nobody is left once the others have disarmed", () => {
    const prices = panel("prices");
    const gold = panel("gold");
    arm(prices);
    arm(gold);
    disarm(gold);
    // undefined is what tells the hook to navigate.
    expect(nextAfter(prices)).toBeUndefined();
  });

  it("promotes the next panel when the first disarms", () => {
    const prices = panel("prices");
    const gold = panel("gold");
    arm(prices);
    arm(gold);
    disarm(prices);
    expect(answers(gold), "a click after the first panel saved has nobody to answer it").toBe(true);
  });

  it("keeps arming idempotent", () => {
    // The effect re-runs on a changed `onIntercept`, and a panel that armed
    // twice would be asked twice about one navigation.
    const prices = panel("prices");
    arm(prices);
    arm(prices);
    disarm(prices);
    expect(nextAfter(null)).toBeUndefined();
  });
});
