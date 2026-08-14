"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

/** A panel with unsaved work, and how to ask it about a pending destination. */
interface ArmedPanel {
  ask: (href: string) => void;
}

/**
 * Every panel on the page currently holding unsaved work, in the order each
 * became dirty. Module-level on purpose: the logs page has more than one, and
 * they have to take turns rather than each throw up its own dialog.
 */
const armed = new Set<ArmedPanel>();

/**
 * Stop a click from leaving the page while there is unsaved work on it.
 *
 * `beforeunload` only covers a real unload — a reload, a closed tab, a typed
 * URL. It does nothing about a client-side navigation, which is how somebody
 * actually leaves a page here: a raider's name, a tab, the nav bar. Next gives
 * `<Link>` an `onNavigate` that can cancel, but only per link, and the links
 * that lose the work are scattered across components that have no idea any
 * work is open.
 *
 * So this listens on the document in the **capture** phase, which runs before
 * React's delegated handler and therefore before `<Link>` starts navigating.
 * An intercepted click hands its destination back, and the caller decides —
 * usually a dialog offering to save first. Nothing is blocked outright: the
 * caller calls `leave` when it's ready.
 *
 * **Leave through `leave`, not `router.push`.** Two panels on this page can be
 * dirty at once, and a raw push out of the first one's dialog would drop the
 * second one's edits without ever mentioning them. `leave` asks each remaining
 * dirty panel in turn and navigates only once nobody objects — which is also
 * why only the first-armed panel answers a click, so the turns never overlap.
 *
 * **Browser back and forward are not covered.** Cancelling a `popstate` means
 * pushing a decoy history entry and rewriting the user's back button, which
 * misbehaves in ways worse than the problem. The dialog is for the clicks it
 * can honestly catch; keep an unsaved marker visible for everything else.
 */
export function useUnsavedGuard({
  when,
  onIntercept,
}: {
  /** True while there is work that a navigation would throw away. */
  when: boolean;
  /**
   * Called with the destination of a click that was stopped, as a path. Must be
   * stable across renders — a `useState` setter or a `useCallback`.
   */
  onIntercept: (href: string) => void;
}) {
  const router = useRouter();
  const selfRef = React.useRef<ArmedPanel | null>(null);

  React.useEffect(() => {
    if (!when) return;

    const self: ArmedPanel = { ask: onIntercept };
    selfRef.current = self;
    armed.add(self);

    const warn = (e: BeforeUnloadEvent) => e.preventDefault();

    const onClick = (e: MouseEvent) => {
      // One dialog at a time: whoever armed first answers, and passes the
      // destination along to the others through `leave`.
      if (armed.values().next().value !== self) return;

      // Anything that wasn't going to navigate this tab anyway: a modified
      // click opens a new one, and a non-primary button isn't a navigation.
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const anchor = (e.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.hasAttribute("download")) return;
      if (anchor.target && anchor.target !== "_self") return;

      // An external link unloads the document, so `beforeunload` has it. Same
      // for a bare hash on the current page: nothing unmounts, nothing is lost.
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;

      e.preventDefault();
      e.stopPropagation();
      onIntercept(`${url.pathname}${url.search}${url.hash}`);
    };

    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", onClick, true);
    return () => {
      armed.delete(self);
      selfRef.current = null;
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", onClick, true);
    };
  }, [when, onIntercept]);

  /**
   * Go to `href` — once every *other* panel still holding unsaved work has had
   * its say. Calling this from a dialog is what makes "leave" mean leave,
   * rather than "leave and quietly discard whatever else was open".
   */
  const leave = React.useCallback(
    (href: string) => {
      // Our own entry may not be cleaned up yet — the effect tears down after
      // the commit that cleared `when`, and a dialog calls this during it.
      const next = [...armed].find((panel) => panel !== selfRef.current);
      if (next) next.ask(href);
      else router.push(href);
    },
    [router],
  );

  return { leave };
}
