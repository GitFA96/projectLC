import { describe, expect, it } from "vitest";
import { runChecks } from "./doctor-checks.mjs";

/**
 * The doctor exists because every one of these failures is silent. Its own
 * failure would be silent too, so the checks that matter are pinned here.
 */
const prod = (extra: Record<string, string | undefined> = {}) => ({
  NODE_ENV: "production",
  PROJECTLC_AUTH: "on",
  PROJECTLC_DB: "/data/projectlc.db",
  DISCORD_CLIENT_ID: "id",
  DISCORD_CLIENT_SECRET: "secret",
  DISCORD_REDIRECT_URI: "https://lc.example.com/api/auth/discord/callback",
  WCL_CLIENT_ID: "w",
  WCL_CLIENT_SECRET: "w",
  TZ: "Europe/Oslo",
  ...extra,
});

const messages = (env: Record<string, string | undefined>, node = "v24.0.0") =>
  runChecks(env, node).errors.join("\n");

describe("doctor", () => {
  it("passes a correctly configured production deployment", () => {
    const { errors, warnings } = runChecks(prod(), "v24.0.0");
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("fails a Node below the node:sqlite floor", () => {
    expect(messages(prod(), "v22.12.0")).toMatch(/below the 22\.13 floor/);
    expect(runChecks(prod(), "v22.13.0").errors).toEqual([]);
  });

  it("fails production without enforcement, and is not fooled by truthy values", () => {
    for (const value of [undefined, "true", "1", "off", ""]) {
      expect(messages(prod({ PROJECTLC_AUTH: value }))).toMatch(/PROJECTLC_AUTH/);
    }
  });

  it("fails on disabled TLS verification, in any environment", () => {
    expect(messages(prod({ NODE_TLS_REJECT_UNAUTHORIZED: "0" }))).toMatch(/certificate verification/);
    expect(messages({ NODE_TLS_REJECT_UNAUTHORIZED: "0" })).toMatch(/certificate verification/);
  });

  it("fails the read-only demo backend in production", () => {
    expect(messages(prod({ DATA_BACKEND: "seed" }))).toMatch(/read-only demo/);
  });

  it("fails a relative or missing database path in production", () => {
    expect(messages(prod({ PROJECTLC_DB: undefined }))).toMatch(/vanishes on redeploy/);
    expect(messages(prod({ PROJECTLC_DB: "data/projectlc.db" }))).toMatch(/absolute path/);
  });

  it("catches the redirect URI mistakes Discord fails on, not us", () => {
    expect(messages(prod({ DISCORD_REDIRECT_URI: "https://lc.example.com/callback" }))).toMatch(/must end with/);
    expect(messages(prod({ DISCORD_REDIRECT_URI: "http://lc.example.com/api/auth/discord/callback" })))
      .toMatch(/plain HTTP/);
    // localhost over http is how you develop, and must not be an error.
    expect(runChecks(prod({ DISCORD_REDIRECT_URI: "http://localhost:3000/api/auth/discord/callback" }), "v24.0.0").errors)
      .toEqual([]);
  });

  it("warns rather than fails on the timezone trap", () => {
    const { errors, warnings } = runChecks(prod({ TZ: undefined }), "v24.0.0");
    expect(errors).toEqual([]);
    expect(warnings.join("\n")).toMatch(/17:30/);
  });

  it("leaves development alone", () => {
    const { errors } = runChecks({ NODE_ENV: "development" }, "v24.0.0");
    expect(errors).toEqual([]);
  });
});
