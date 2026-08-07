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
 * The script that runs before first paint, as source text.
 *
 * It is inlined into <head> rather than loaded, because a fetched script — even
 * `beforeInteractive` — is not guaranteed to execute before the browser paints,
 * and a light page flashing ahead of a dark one is the whole thing we're
 * avoiding. Kept tiny and dependency-free for the same reason.
 *
 * Wrapped in try/catch because reading localStorage throws outright when the
 * user blocks storage; the theme then falls back to the OS preference rather
 * than taking the page down with it.
 */
export const THEME_SCRIPT = `(function(){try{var p=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});var d=p==="dark"||(p!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);document.documentElement.style.colorScheme=d?"dark":"light";}catch(e){}})();`;
