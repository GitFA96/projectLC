"use client";

import * as React from "react";

/**
 * The reader's own text size for the preparedness table, remembered per browser.
 *
 * A raid night is as wide as its longest consumable name, and how much of that
 * is worth trading for a horizontal scrollbar is a preference, not something a
 * component can decide: a 34" ultrawide and a laptop want opposite things from
 * the same report. So the table is allowed to be wide and the reader shrinks it
 * until it fits — or doesn't, and scrolls.
 *
 * Kept outside React and read through `useSyncExternalStore`, because the
 * server has no localStorage: it renders 100% and React swaps the reader's own
 * size in after hydration, instead of the two disagreeing about the first
 * paint. The feedback list reads its "last seen" stamp the same way.
 *
 * The module-level mirror is also the whole store when storage is blocked — the
 * control still works for the visit, it just isn't remembered for the next one.
 */

const TEXT_SCALE_KEY = "projectlc.preparedness.textScale";

export const SCALE_MIN = 0.6;
export const SCALE_MAX = 1.3;
export const SCALE_STEP = 0.1;

const clampScale = (n: number) => Math.min(SCALE_MAX, Math.max(SCALE_MIN, n));

const scaleListeners = new Set<() => void>();
let currentScale: number | undefined;

export function subscribeTextScale(onStoreChange: () => void) {
  scaleListeners.add(onStoreChange);
  return () => void scaleListeners.delete(onStoreChange);
}

/** The store's current answer for this browser. 100% until something says otherwise. */
export function readTextScale(): number {
  if (currentScale === undefined) {
    try {
      const saved = Number(localStorage.getItem(TEXT_SCALE_KEY));
      currentScale = Number.isFinite(saved) && saved > 0 ? clampScale(saved) : 1;
    } catch {
      currentScale = 1;
    }
  }
  return currentScale;
}

/** `by` undefined resets to 100%. Steps are relative to the stored value. */
export function changeScale(by?: number) {
  currentScale = by === undefined ? 1 : clampScale(Math.round((readTextScale() + by) * 100) / 100);
  try {
    localStorage.setItem(TEXT_SCALE_KEY, String(currentScale));
  } catch {
    // Not remembered for next time; still applied to this one.
  }
  for (const notify of scaleListeners) notify();
}

/** The reader's scale, or 100% on the server and before hydration. */
export function useTextScale(): number {
  return React.useSyncExternalStore(subscribeTextScale, readTextScale, () => 1);
}

/**
 * Throw away the module-level mirror. Exists for tests, which need each case to
 * start from a browser that has just loaded the page — the mirror is a
 * per-process cache and would otherwise carry one case's scale into the next.
 */
export function resetTextScaleForTests() {
  currentScale = undefined;
  scaleListeners.clear();
}
