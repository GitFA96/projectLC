import { describe, expect, it } from "vitest";
import { togglesOnPress } from "@/components/use-press-toggle";

/**
 * The rule that lets a fold-away header be both clickable and selectable.
 *
 * Thin on purpose — the hard half is reading the DOM, and there is no jsdom in
 * this repo (`docs/improvement-plan.md` §6). What is worth pinning is the
 * asymmetry: a selection *inside* the header blocks the fold, and a selection
 * anywhere else must not, because that one is the case where getting it wrong
 * produces a card that silently refuses to open.
 */
describe("togglesOnPress", () => {
  it("folds on an ordinary press", () => {
    expect(togglesOnPress({ defaultPrevented: false, selectedInHeader: false })).toBe(true);
  });

  it("does not fold the card out from under text just marked in it", () => {
    expect(togglesOnPress({ defaultPrevented: false, selectedInHeader: true })).toBe(false);
  });

  it("leaves a click something inside already handled alone", () => {
    expect(togglesOnPress({ defaultPrevented: true, selectedInHeader: false })).toBe(false);
  });
});
