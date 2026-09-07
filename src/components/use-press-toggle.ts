"use client";

import * as React from "react";

/**
 * Click a header to fold its card, and still be able to select the text in it.
 *
 * These headers carry the numbers people quote at each other — what a night
 * banked, what a mark is worth, how much is still to hand out. Marking one to
 * copy it is a reasonable thing to want, and there were two ways it failed.
 * Most of the headers set `select-none`, so the text could not be marked at
 * all. The prices header did not, so it could — and the mouse-up that finished
 * the selection also counted as a click and folded the card away underneath it,
 * which is worse: the officer loses the text *and* the panel.
 *
 * So the rule is here rather than in a class: **a click that ends a text
 * selection is not a press.** With that, `select-none` comes off and both
 * behaviours are had at once.
 *
 * Keyboard activation is deliberately not added here. These headers carry
 * `role="button"` without a `tabIndex`, so they are not reachable by tab today;
 * giving them one would change the tab order of every page they appear on,
 * which is a decision about the whole app rather than about this rule.
 */

/** A click, in the terms the decision needs — not the event that carried it. */
export interface PressFacts {
  /** Something inside the header already handled it. */
  defaultPrevented: boolean;
  /**
   * There is a text selection, and it lies inside the header that was clicked.
   *
   * Inside matters. A selection somewhere else on the page is almost always
   * collapsed by the time this runs — pressing the mouse down clears it — but
   * where one survives, it says nothing about what the officer meant by
   * clicking *here*, and blocking the toggle over it would leave a card that
   * refuses to open for no visible reason.
   */
  selectedInHeader: boolean;
}

/** Whether a click on a fold-away header should actually fold it. */
export function togglesOnPress(facts: PressFacts): boolean {
  return !facts.defaultPrevented && !facts.selectedInHeader;
}

/**
 * Props for a header that folds its card when pressed and lets its text be
 * marked when dragged. Spread onto the clickable element.
 */
export function usePressToggle(toggle: () => void): {
  onClick: (e: React.MouseEvent<HTMLElement>) => void;
} {
  return {
    onClick: (e) => {
      const selection = typeof window === "undefined" ? null : window.getSelection();
      // `currentTarget` is the header itself, which is exactly the subtree the
      // selection has to be in for it to be this header's business.
      const selectedInHeader =
        selection !== null &&
        !selection.isCollapsed &&
        selection.anchorNode !== null &&
        e.currentTarget.contains(selection.anchorNode);

      if (!togglesOnPress({ defaultPrevented: e.defaultPrevented, selectedInHeader })) return;
      toggle();
    },
  };
}
