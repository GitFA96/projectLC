import { describe, expect, it } from "vitest";
import { assertAuthConfigured } from "@/lib/auth/boot";

/**
 * The guard exists because the failure it prevents is silent. These pin the
 * two halves that matter: production refuses anything but "on", and no other
 * environment is affected at all.
 */
describe("assertAuthConfigured", () => {
  it("lets production boot when enforcement is on", () => {
    expect(() => assertAuthConfigured({ NODE_ENV: "production", PROJECTLC_AUTH: "on" })).not.toThrow();
  });

  it("refuses to boot in production when the flag is absent", () => {
    expect(() => assertAuthConfigured({ NODE_ENV: "production" })).toThrow(/must be "on" in production/);
  });

  it("names what it actually saw, so the fix is obvious", () => {
    expect(() => assertAuthConfigured({ NODE_ENV: "production" })).toThrow(/it is unset/);
    expect(() => assertAuthConfigured({ NODE_ENV: "production", PROJECTLC_AUTH: "yes" })).toThrow(/it is "yes"/);
  });

  it("is not satisfied by any truthy value", () => {
    // Same rule authEnabled() applies: a deployment that sets PROJECTLC_AUTH=true
    // or =1 has said something, and what it said is not "on". Failing loudly
    // beats guessing they meant to enforce.
    for (const value of ["true", "1", "yes", "off", "false", ""]) {
      expect(
        () => assertAuthConfigured({ NODE_ENV: "production", PROJECTLC_AUTH: value }),
        `PROJECTLC_AUTH=${JSON.stringify(value)} should not satisfy the guard`,
      ).toThrow();
    }
  });

  it("leaves every other environment alone", () => {
    // Development and test run with enforcement off constantly; the guard must
    // be invisible there or it would be the thing everybody works around.
    // `undefined` is included on purpose — NODE_ENV is genuinely unset when a
    // script runs the app directly, and that must not trip the guard. The cast
    // is because NodeJS.ProcessEnv types NODE_ENV as a closed union.
    for (const NODE_ENV of ["development", "test", undefined] as const) {
      const env = { NODE_ENV } as NodeJS.ProcessEnv;
      expect(() => assertAuthConfigured(env)).not.toThrow();
      expect(() => assertAuthConfigured({ ...env, PROJECTLC_AUTH: "off" })).not.toThrow();
    }
  });
});
