import { describe, expect, it } from "vitest";
import {
  buildLabel,
  classOfSettings,
  professionsOfSettings,
  profileCheck,
  raceOfSettings,
  sameBuild,
  specFingerprints,
  specOfPull,
  specOptionKey,
  specsForBuild,
} from "@/lib/sim/profile";
import type { IndividualSimSettings } from "@/lib/sim/request";
import type { WclPlayerFight } from "@/lib/types";

/**
 * The fixtures are the guild's real shapes, taken off a read-only copy of the
 * live database — including the builds Warcraft Logs names inconsistently,
 * which is the case a hard-coded spec table would get wrong.
 */

type PullLike = Pick<WclPlayerFight, "spec" | "className" | "talents" | "sappers">;

const pull = (over: Partial<PullLike> = {}): PullLike => ({
  className: "Warrior",
  spec: "Fury",
  talents: [21, 40, 0],
  sappers: 0,
  ...over,
});

/** Enough of a pull row for the fingerprint pass, which reads four fields. */
const logged = (className: string, spec: string | undefined, talents: number[], n = 1) =>
  Array.from({ length: n }, () => ({ className, spec, talents }) as WclPlayerFight);

const katzewarr: IndividualSimSettings = {
  player: {
    class: "ClassWarrior",
    race: "RaceHuman",
    // wowsims drops the trailing empty tree; the logs never do.
    talentsString: "3400502130201-55000005505012050115",
    dpsWarrior: { options: {} },
    profession1: "Engineering",
    profession2: "Blacksmithing",
  },
};

describe("reading a wowsims export", () => {
  it("takes the class from the field that states it", () => {
    expect(classOfSettings(katzewarr)).toBe("Warrior");
  });

  it("says nothing rather than guessing when the field is absent", () => {
    expect(classOfSettings({ player: {} })).toBeUndefined();
  });

  it("finds the spec-options key by the class it already knows", () => {
    // Structural, not a memorised list: whichever key ends in the class name.
    expect(specOptionKey(katzewarr)).toBe("dpsWarrior");
    expect(
      specOptionKey({ player: { class: "ClassShaman", enhancementShaman: {} } }),
    ).toBe("enhancementShaman");
    // Several classes name the key after the class alone.
    expect(specOptionKey({ player: { class: "ClassWarlock", warlock: {} } })).toBe("warlock");
  });

  it("never mistakes the class field itself for the spec key", () => {
    expect(specOptionKey({ player: { class: "ClassWarlock" } })).toBeUndefined();
  });

  it("splits a run-together race name", () => {
    expect(raceOfSettings({ player: { race: "RaceBloodElf" } })).toBe("Blood Elf");
  });

  it("drops the placeholder profession rather than reporting it", () => {
    expect(
      professionsOfSettings({ player: { profession1: "Engineering", profession2: "ProfessionUnknown" } }),
    ).toEqual(["Engineering"]);
  });
});

describe("sameBuild", () => {
  it("treats a dropped trailing tree as the same build", () => {
    // The exact false positive talentWarning was fixed for: "21/40" is "21/40/0".
    expect(sameBuild([21, 40], [21, 40, 0])).toBe(true);
  });

  it("still catches a real difference", () => {
    expect(sameBuild([21, 40, 0], [33, 28, 0])).toBe(false);
  });

  it("is false when either side has nothing", () => {
    expect(sameBuild(undefined, [21, 40, 0])).toBe(false);
  });
});

describe("specFingerprints", () => {
  it("learns the spec name from the pulls the logs did label", () => {
    const fp = specFingerprints([
      ...logged("Warrior", "Fury", [21, 40, 0], 76),
      ...logged("Warrior", "Arms", [33, 28, 0], 34),
    ]);
    expect(specsForBuild(fp, "Warrior", [21, 40, 0])).toEqual([{ spec: "Fury", pulls: 76 }]);
    expect(specsForBuild(fp, "Warrior", [33, 28, 0])).toEqual([{ spec: "Arms", pulls: 34 }]);
  });

  it("names every spec the logs used for one build, not just the commonest", () => {
    /*
     * Real data: Warcraft Logs calls 0/44/17 Feral, Guardian AND Warden — it
     * reads the role off what the druid was doing, not off the build. Picking
     * the most common one and calling it the answer would state something the
     * source doesn't.
     */
    const fp = specFingerprints([
      ...logged("Druid", "Feral", [0, 44, 17], 199),
      ...logged("Druid", "Guardian", [0, 44, 17], 99),
      ...logged("Druid", "Warden", [0, 44, 17], 19),
    ]);
    expect(specsForBuild(fp, "Druid", [0, 44, 17]).map((n) => n.spec)).toEqual([
      "Feral",
      "Guardian",
      "Warden",
    ]);
  });

  it("matches a wowsims build with its trailing tree dropped", () => {
    const fp = specFingerprints(logged("Warrior", "Fury", [21, 40, 0], 5));
    expect(specsForBuild(fp, "Warrior", [21, 40]).map((n) => n.spec)).toEqual(["Fury"]);
  });

  it("ignores pulls the logs never labelled — they are what it exists to answer", () => {
    const fp = specFingerprints(logged("Mage", undefined, [40, 0, 21], 55));
    expect(specsForBuild(fp, "Mage", [40, 0, 21])).toEqual([]);
  });

  it("keeps classes apart even when two share a build shape", () => {
    const fp = specFingerprints([
      ...logged("Hunter", "BeastMastery", [41, 20, 0], 238),
      ...logged("Paladin", "Holy", [41, 20, 0], 11),
    ]);
    expect(specsForBuild(fp, "Hunter", [41, 20, 0]).map((n) => n.spec)).toEqual(["BeastMastery"]);
    expect(specsForBuild(fp, "Paladin", [41, 20, 0]).map((n) => n.spec)).toEqual(["Holy"]);
  });
});

describe("specOfPull", () => {
  it("prefers what the log said outright", () => {
    const fp = specFingerprints(logged("Warrior", "Fury", [21, 40, 0], 76));
    expect(specOfPull(pull({ spec: "Arms" }), fp)).toEqual({
      spec: "Arms",
      inferred: false,
      alternatives: [],
    });
  });

  it("recovers a spec the log left blank from the build", () => {
    // Warcraft Logs leaves plenty of rows unlabelled — all of this guild's are
    // wipes today, which the sim section skips anyway, but a kill landing here
    // would otherwise vanish from the picker with no visible reason.
    const fp = specFingerprints(logged("Warrior", "Fury", [21, 40, 0], 76));
    expect(specOfPull(pull({ spec: undefined }), fp)).toEqual({
      spec: "Fury",
      inferred: true,
      alternatives: [],
    });
  });

  it("carries the other names when the build is named several ways", () => {
    const fp = specFingerprints([
      ...logged("Druid", "Feral", [0, 44, 17], 199),
      ...logged("Druid", "Guardian", [0, 44, 17], 99),
    ]);
    const out = specOfPull({ className: "Druid", spec: undefined, talents: [0, 44, 17] }, fp);
    expect(out.spec).toBe("Feral");
    expect(out.alternatives).toEqual(["Guardian"]);
  });

  it("answers nothing when no pull has ever named the build", () => {
    expect(specOfPull(pull({ spec: undefined }), specFingerprints([]))).toEqual({
      inferred: false,
      alternatives: [],
    });
  });
});

describe("profileCheck", () => {
  const fp = specFingerprints([
    ...logged("Warrior", "Fury", [21, 40, 0], 76),
    ...logged("Warrior", "Arms", [33, 28, 0], 34),
  ]);
  const check = (over: Partial<PullLike> = {}) =>
    profileCheck({
      settings: katzewarr,
      spec: "Fury",
      wowClass: "Warrior",
      pull: pull(over),
      fingerprints: fp,
    });
  const row = (rows: ReturnType<typeof check>, label: string) =>
    rows.find((r) => r.label === label)!;

  it("confirms the raider played the profile's spec and build", () => {
    const rows = check();
    expect(row(rows, "Class").state).toBe("match");
    expect(row(rows, "Spec").state).toBe("match");
    expect(row(rows, "Talents").state).toBe("match");
  });

  it("flags the Fury profile aimed at an Arms pull", () => {
    // The case the whole card exists for, now that one setup serves everyone
    // of a spec: same raider, same class, different night, different build.
    const rows = check({ spec: "Arms", talents: [33, 28, 0] });
    expect(row(rows, "Class").state).toBe("match");
    expect(row(rows, "Spec").state).toBe("differs");
    expect(row(rows, "Talents").state).toBe("differs");
    expect(row(rows, "Talents").logged).toBe("33/28/0");
  });

  it("names the build's spec in the talents note, from the guild's own logs", () => {
    expect(row(check(), "Talents").note).toContain("Fury");
  });

  it("says a spec it recovered from the build was recovered", () => {
    const rows = check({ spec: undefined });
    expect(row(rows, "Spec").state).toBe("match");
    expect(row(rows, "Spec").logged).toContain("unlabelled");
  });

  it("catches a setup for the wrong class outright", () => {
    const rows = profileCheck({
      settings: katzewarr,
      spec: "Enhancement",
      wowClass: "Shaman",
      pull: pull({ className: "Shaman", spec: "Enhancement", talents: [2, 45, 14] }),
      fingerprints: fp,
    });
    expect(row(rows, "Class").state).toBe("differs");
  });

  it("reports race as unconfirmable rather than as agreement", () => {
    // A shared spec profile carries one race and the logs record none. Reading
    // that as a match would launder an assumption into a confirmation.
    expect(row(check(), "Race")).toMatchObject({ profile: "Human", state: "unknown" });
  });

  it("confirms engineering from a thrown sapper", () => {
    expect(row(check({ sappers: 2 }), "Professions").state).toBe("match");
  });

  it("does not treat a pull without sappers as contradicting engineering", () => {
    // Nobody throws one on every pull; absence is not evidence here.
    expect(row(check({ sappers: 0 }), "Professions").state).toBe("unknown");
  });

  it("leaves out rows the setup has nothing to say about", () => {
    const rows = profileCheck({
      settings: { player: { class: "ClassWarrior" } },
      spec: "Fury",
      wowClass: "Warrior",
      pull: pull(),
      fingerprints: fp,
    });
    expect(rows.some((r) => r.label === "Race")).toBe(false);
    expect(rows.some((r) => r.label === "Professions")).toBe(false);
    expect(row(rows, "Talents").state).toBe("unknown");
  });
});

describe("buildLabel", () => {
  it("pads to a shared width so two builds print comparably", () => {
    expect(buildLabel([21, 40])).toBe("21/40/0");
  });

  it("never truncates a build wider than the default", () => {
    expect(buildLabel([1, 2, 3, 4])).toBe("1/2/3/4");
  });
});
