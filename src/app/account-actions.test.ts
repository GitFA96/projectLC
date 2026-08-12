import { afterEach, describe, expect, it } from "vitest";
import { whoAmI } from "./account-actions";

const original = process.env.PROJECTLC_AUTH;
afterEach(() => {
  if (original === undefined) delete process.env.PROJECTLC_AUTH;
  else process.env.PROJECTLC_AUTH = original;
});

describe("what the account menu is told", () => {
  it("says nobody when there is no request to read a cookie from", async () => {
    // Outside a request there is no session, and the only safe answer to "who
    // is this" is nobody. Guessing the other way would report somebody signed
    // in on the strength of no evidence at all.
    const me = await whoAmI();
    expect(me.signedIn).toBe(false);
    expect(me.displayName).toBeNull();
    expect(me.appAdmin).toBe(false);
  });

  it("reports whether permissions are actually being enforced", async () => {
    /*
     * The reason this field exists. "Signed in" and "being signed in matters"
     * are different facts: with PROJECTLC_AUTH off every check passes for
     * everybody, so somebody reading their own name in the corner would
     * otherwise reasonably assume they were protected by it.
     */
    delete process.env.PROJECTLC_AUTH;
    expect((await whoAmI()).enforcing).toBe(false);

    process.env.PROJECTLC_AUTH = "on";
    expect((await whoAmI()).enforcing).toBe(true);

    // Anything other than the exact opt-in is off — a half-set flag must never
    // read as protection.
    process.env.PROJECTLC_AUTH = "true";
    expect((await whoAmI()).enforcing).toBe(false);
  });

  it("never answers about anybody but the caller", async () => {
    // The shape is the guarantee: there is no argument to pass, so there is no
    // way to ask this about another person.
    expect(whoAmI.length).toBe(0);
  });
});
