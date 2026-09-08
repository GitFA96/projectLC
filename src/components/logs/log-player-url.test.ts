import { describe, expect, it } from "vitest";
import { logPlayerGearHref, logPlayerHref } from "@/components/logs/log-player-url";

describe("logPlayerHref", () => {
  it("lowercases the name, so two spellings are one page", () => {
    expect(logPlayerHref("Zoltrak")).toBe("/logs/player/zoltrak");
    expect(logPlayerHref("ZOLTRAK")).toBe(logPlayerHref("zoltrak"));
  });

  it("encodes a name that needs it", () => {
    // Non-ASCII names are ordinary on an EU realm, and the path segment is the
    // only thing identifying the player.
    expect(logPlayerHref("Þórâ")).toBe("/logs/player/%C3%BE%C3%B3r%C3%A2");
  });

  it("opens their newest night when no report is named", () => {
    expect(logPlayerHref("zoltrak")).not.toContain("?");
  });

  it("opens the named night when one is", () => {
    const params = new URLSearchParams(logPlayerHref("zoltrak", "aB3xY").split("?")[1]);
    expect(params.get("report")).toBe("aB3xY");
  });

  it("keeps the report code's case — a WCL code is case-sensitive", () => {
    expect(logPlayerHref("zoltrak", "aB3xY")).toContain("report=aB3xY");
  });

  it("aims the gear link at the audit's anchor", () => {
    expect(logPlayerGearHref("Zoltrak", "aB3xY")).toBe("/logs/player/zoltrak?report=aB3xY#enchants");
  });
});
