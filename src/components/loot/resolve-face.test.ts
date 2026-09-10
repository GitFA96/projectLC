import { describe, expect, it } from "vitest";
import { resolveControlFace } from "@/components/loot/resolve-face";

/**
 * The ledger's winner control, which is a reading problem rather than a markup
 * one and is where this control went wrong.
 *
 * Both states used to read "Resolve": an award somebody had already settled
 * off-roster was indistinguishable from one nobody had touched, so it was
 * opened again by whoever scanned the ledger next. What that costs is not a
 * click — it is that the ledger never reads as finished, and an officer cannot
 * tell how much of the night is still open without opening every dropdown.
 */
describe("resolveControlFace", () => {
  it("asks for a decision only where one is still owed", () => {
    expect(resolveControlFace("unresolved").open).toBe(true);
    expect(resolveControlFace("external").open).toBe(false);
  });

  it("never says Resolve about an award that has been resolved", () => {
    expect(resolveControlFace("external").label).not.toMatch(/resolve/i);
  });

  it("names the settled state rather than the action on it", () => {
    // Same words the ledger's Winner filter uses for the same rows, so
    // filtering to "Off roster" and reading a row agree.
    expect(resolveControlFace("external").label).toBe("Off roster");
  });

  it("says why on hover in both states", () => {
    for (const mode of ["unresolved", "external"] as const) {
      expect(resolveControlFace(mode).title.length).toBeGreaterThan(20);
    }
  });
});
