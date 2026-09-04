"use client";

import * as React from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import {
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  isThemePreference,
  prefersDarkTheme,
  type ThemePreference,
} from "@/lib/theme";
import { cn } from "@/lib/utils";

const ICONS = { system: Monitor, light: Sun, dark: Moon } as const;
const LABELS = { system: "Match system", light: "Light", dark: "Dark" } as const;

/**
 * The stored preference, read as an external store rather than mirrored into
 * state. localStorage is exactly that — state React doesn't own — and going
 * through `useSyncExternalStore` is what keeps the server render ("system",
 * since the server cannot know) and the hydrated client render from
 * disagreeing.
 */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // `storage` fires in *other* tabs, so a theme change follows the guild
  // officer across every projectLC tab they have open.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    // Storage blocked — fall back to the OS, same as the pre-paint script.
    return "system";
  }
}

/** Apply a preference to <html>, the same way the pre-paint script does. */
function applyTheme(preference: ThemePreference) {
  // Same rule, same function: `theme.test.ts` holds the pre-paint script to it.
  const dark = prefersDarkTheme(
    preference,
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

function setPreference(next: ThemePreference) {
  try {
    // "system" is the absence of a choice, so it clears rather than stores —
    // a browser that has never seen this app then behaves identically.
    if (next === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Storage blocked: the theme still applies for this page view.
  }
  applyTheme(next);
  for (const listener of listeners) listener();
}

/**
 * Cycles system → light → dark. Three states rather than two so someone can
 * pin the theme for a projector or a screenshot without touching their OS,
 * and still hand it back afterwards.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const preference = React.useSyncExternalStore(
    subscribe,
    readPreference,
    () => "system" as const,
  );

  // On "system", keep following the OS while the page is open — someone whose
  // machine flips at sunset should see this flip too, without a reload.
  React.useEffect(() => {
    if (preference !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference]);

  const cycle = () =>
    setPreference(
      THEME_PREFERENCES[(THEME_PREFERENCES.indexOf(preference) + 1) % THEME_PREFERENCES.length],
    );

  const Icon = ICONS[preference];
  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`Theme: ${LABELS[preference]}. Click to change.`}
      title={`Theme: ${LABELS[preference]}`}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
    >
      <Icon className="h-4 w-4" aria-hidden />
    </button>
  );
}
