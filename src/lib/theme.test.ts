import { describe, expect, it } from "vitest";
import {
  THEME_PREFERENCES,
  THEME_SCRIPT,
  THEME_STORAGE_KEY,
  isThemePreference,
  prefersDarkTheme,
} from "@/lib/theme";

/**
 * The pre-paint script and the toggle must not disagree.
 *
 * They cannot share code: `THEME_SCRIPT` is source text handed to a browser
 * that has loaded nothing yet, so the rule is written twice on purpose. What
 * that costs is a bug with no error message — the script paints one theme
 * before first paint and React swaps to the other a moment later, which reads
 * as "the page flashes" and is nobody's obvious fault.
 *
 * So the script is executed here, in a fake document, and checked against
 * `prefersDarkTheme` — the function the toggle calls — for every combination
 * of stored value and OS preference. The toggle side needs no test of its own
 * because it has no rule of its own left.
 */

/** Just enough of `<html>` for the script to write to. */
function fakeDocument() {
  const classes = new Set<string>();
  return {
    classes,
    style: {} as { colorScheme?: string },
    get documentElement() {
      return {
        classList: {
          toggle: (name: string, force: boolean) => (force ? classes.add(name) : classes.delete(name)),
        },
        style: this.style,
      };
    },
  };
}

interface Browser {
  /** `null` = nothing stored. A string = whatever is in localStorage. */
  stored: string | null;
  systemPrefersDark: boolean;
  /** Some browsers throw on `localStorage` rather than returning nothing. */
  storageThrows?: boolean;
}

/** Run the real inlined script against a fake browser, and report what it did. */
function runPrePaint({ stored, systemPrefersDark, storageThrows }: Browser) {
  const doc = fakeDocument();
  const asked: string[] = [];
  const localStorage = {
    getItem(key: string) {
      asked.push(key);
      if (storageThrows) throw new Error("storage blocked");
      return stored;
    },
  };
  const window = {
    matchMedia: (query: string) => ({ matches: query.includes("dark") && systemPrefersDark }),
  };
  // `new Function` rather than `eval`: the script's own `document`, `window`
  // and `localStorage` become parameters, so nothing here can reach a real one.
  new Function("document", "window", "localStorage", THEME_SCRIPT)(doc, window, localStorage);
  return { dark: doc.classes.has("dark"), colorScheme: doc.style.colorScheme, asked };
}

const STORED_VALUES = [null, "dark", "light", "system", "", "DARK", "nonsense"];

describe("the rule itself", () => {
  it("follows a stored choice", () => {
    expect(prefersDarkTheme("dark", false)).toBe(true);
    expect(prefersDarkTheme("light", true)).toBe(false);
  });

  it("follows the OS when nothing was chosen", () => {
    expect(prefersDarkTheme("system", true)).toBe(true);
    expect(prefersDarkTheme("system", false)).toBe(false);
    expect(prefersDarkTheme(null, true)).toBe(true);
  });

  it("treats a value it does not recognise as no choice at all", () => {
    // Not pedantry: "DARK" is what a hand-edited localStorage looks like, and
    // the two sides reach this outcome by different routes — the toggle
    // validates and falls back to "system", the script just checks the value
    // is not "light". Both must land on the OS preference.
    expect(prefersDarkTheme("DARK", false)).toBe(false);
    expect(prefersDarkTheme("nonsense", true)).toBe(true);
  });
});

describe("the pre-paint script agrees with it", () => {
  const cases = STORED_VALUES.flatMap((stored) =>
    [true, false].map((systemPrefersDark) => ({ stored, systemPrefersDark })),
  );

  it.each(cases)("stored $stored, OS dark $systemPrefersDark", ({ stored, systemPrefersDark }) => {
    const fromScript = runPrePaint({ stored, systemPrefersDark });
    expect(fromScript.dark).toBe(prefersDarkTheme(stored, systemPrefersDark));
    // Both sides also set colour-scheme, so form controls and scrollbars match.
    expect(fromScript.colorScheme).toBe(fromScript.dark ? "dark" : "light");
  });

  it("reads the key the toggle writes", () => {
    // The key is interpolated into the script, so this can only break by
    // somebody hard-coding a string into one side. It has one job and the
    // symptom is a theme that never restores.
    expect(runPrePaint({ stored: null, systemPrefersDark: false }).asked).toEqual([
      THEME_STORAGE_KEY,
    ]);
  });
});

describe("a browser that refuses to answer", () => {
  it.each([true, false])("falls back to an OS preference of %s without throwing", (osDark) => {
    // Storage can throw outright rather than return nothing. The theme is not
    // worth taking the page down for — and it happens before first paint, so
    // there is nothing rendered yet to show an error in.
    const result = runPrePaint({ stored: null, systemPrefersDark: osDark, storageThrows: true });
    expect(result.dark).toBe(osDark);
  });
});

describe("what counts as a preference", () => {
  it.each(THEME_PREFERENCES)("%s is one", (preference) => {
    expect(isThemePreference(preference)).toBe(true);
  });

  it.each([null, undefined, "", "System", 0, {}])("%s is not", (value) => {
    expect(isThemePreference(value)).toBe(false);
  });

  it("offers system first, so the toggle's cycle starts where a new visitor is", () => {
    expect(THEME_PREFERENCES[0]).toBe("system");
  });
});
