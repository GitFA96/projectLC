/**
 * Theme selection, shared by the toggle and the blocking script in the root
 * layout. Both must agree on the storage key and on how a stored value becomes
 * a class, or the pre-paint pass and React would disagree and the page would
 * flash on every load.
 */

export const THEME_STORAGE_KEY = "projectlc-theme";

/** What the user picked. "system" defers to the OS and keeps following it. */
export type ThemePreference = "light" | "dark" | "system";

export const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

/**
 * Dark or not: the one rule both sides implement.
 *
 * Takes whatever was stored rather than a validated preference, because the
 * pre-paint script has no room to validate — anything that is not "dark" or
 * "light" means "no choice", which is the same as "system" and follows the OS.
 * `theme-toggle.tsx` calls this; `THEME_SCRIPT` below cannot (it is source text
 * for a browser that has loaded nothing yet) and so spells it out again. That
 * duplication is unavoidable and `theme.test.ts` runs the script against this
 * function to keep the two honest.
 */
export function prefersDarkTheme(stored: unknown, systemPrefersDark: boolean): boolean {
  return stored === "dark" || (stored !== "light" && systemPrefersDark);
}

/**
 * The script that runs before first paint, as source text.
 *
 * It is inlined into <head> rather than loaded, because a fetched script — even
 * `beforeInteractive` — is not guaranteed to execute before the browser paints,
 * and a light page flashing ahead of a dark one is the whole thing we're
 * avoiding. Kept tiny and dependency-free for the same reason.
 *
 * Two try/catches, and the inner one is the point. Reading localStorage throws
 * outright when the user blocks storage — but the OS preference is still
 * readable, and a blocked browser is exactly the one that has nothing stored to
 * read anyway. Catching only the read leaves the rest of the script to run, so
 * a dark-mode OS still gets a dark first paint. The outer catch is the
 * belt-and-braces one: nothing about the theme is worth taking a page down for,
 * least of all before it has rendered anything to show an error in.
 *
 * `theme.test.ts` runs this string against `prefersDarkTheme` for every
 * combination of stored value and OS preference. Change one side and it says so.
 */
export const THEME_SCRIPT = `(function(){try{var p=null;try{p=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)})}catch(e){}var d=p==="dark"||(p!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);document.documentElement.style.colorScheme=d?"dark":"light";}catch(e){}})();`;
