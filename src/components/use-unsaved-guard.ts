"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  answers,
  arm,
  disarm,
  interceptedHref,
  nextAfter,
  type ArmedPanel,
} from "@/components/unsaved-navigation";

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
 *
 * Which clicks count, and whose turn it is, are in
 * `@/components/unsaved-navigation` — where a node test can reach them. What is
 * left here is listener plumbing and reading three attributes off an anchor.
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
    arm(self);

    const warn = (e: BeforeUnloadEvent) => e.preventDefault();

    const onClick = (e: MouseEvent) => {
      // One dialog at a time: whoever armed first answers, and passes the
      // destination along to the others through `leave`.
      if (!answers(self)) return;

      const anchor = (e.target as Element | null)?.closest?.("a[href]");
      const href = interceptedHref(
        {
          defaultPrevented: e.defaultPrevented,
          button: e.button,
          modified: e.metaKey || e.ctrlKey || e.shiftKey || e.altKey,
          anchor:
            anchor instanceof HTMLAnchorElement
              ? {
                  href: anchor.href,
                  download: anchor.hasAttribute("download"),
                  target: anchor.target,
                }
              : null,
        },
        window.location.href,
      );
      if (href === null) return;

      e.preventDefault();
      e.stopPropagation();
      onIntercept(href);
    };

    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", onClick, true);
    return () => {
      disarm(self);
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
      const next = nextAfter(selfRef.current);
      if (next) next.ask(href);
      else router.push(href);
    },
    [router],
  );

  return { leave };
}
