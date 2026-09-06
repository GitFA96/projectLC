/**
 * The two decisions behind the unsaved-work guard, with no DOM in either.
 *
 * `use-unsaved-guard.ts` is a `useEffect` that adds two listeners and reads
 * attributes off an anchor. Everything that could actually be *wrong* about it
 * is here instead: which clicks are this guard's business, and which panel
 * answers when more than one is holding unsaved work. Both are decisions with
 * branches and an order; the part left in the hook is plumbing.
 *
 * The residue is honest about itself. That the click listener runs in the
 * capture phase — before React's delegated handler, and therefore before
 * `<Link>` starts navigating — is the subtlest claim in the hook, and no test
 * here can make it: proving it needs React's own delegation in the room. It is
 * a comment there, on purpose.
 */

/** A click, in the terms the decision needs — not the event that carried it. */
export interface ClickFacts {
  /** Something already handled it. */
  defaultPrevented: boolean;
  /** 0 is the primary button; anything else was never a navigation. */
  button: number;
  /** meta, ctrl, shift or alt — a click that opens somewhere else. */
  modified: boolean;
  /** The nearest enclosing `a[href]`, or null if the click was not in one. */
  anchor: { href: string; download: boolean; target: string } | null;
}

/**
 * Where a click would take the page, or `null` when it is none of this guard's
 * business.
 *
 * Two of the refusals are the interesting ones, and both are cases where
 * intercepting would be *worse* than letting the click through:
 *
 * - **An external link unloads the document**, so `beforeunload` already covers
 *   it — and that dialog is the browser's, which cannot be talked out of.
 *   Catching it here would put two dialogs in front of one click.
 * - **A bare hash on the page you are already on** unmounts nothing. There is
 *   no work to lose, and a dialog would be asking about a scroll.
 *
 * @param here the page's current URL, absolute
 */
export function interceptedHref(click: ClickFacts, here: string): string | null {
  if (click.defaultPrevented || click.button !== 0 || click.modified) return null;

  const { anchor } = click;
  if (!anchor) return null;
  if (anchor.download) return null;
  // A named target opens somewhere that is not this document.
  if (anchor.target && anchor.target !== "_self") return null;

  let url: URL;
  let current: URL;
  try {
    current = new URL(here);
    url = new URL(anchor.href, here);
  } catch {
    // An href this cannot parse is not one we can promise to navigate to
    // ourselves, so it is not ours to cancel.
    return null;
  }

  if (url.origin !== current.origin) return null;
  if (url.pathname === current.pathname && url.search === current.search) return null;

  return `${url.pathname}${url.search}${url.hash}`;
}

/** A panel with unsaved work, and how to ask it about a pending destination. */
export interface ArmedPanel {
  ask: (href: string) => void;
}

/**
 * Every panel currently holding unsaved work, in the order each became dirty.
 *
 * Module-level on purpose: the logs page has more than one, and they have to
 * take turns rather than each throw up its own dialog over the same click.
 */
const armed = new Set<ArmedPanel>();

export function arm(panel: ArmedPanel): void {
  armed.add(panel);
}

export function disarm(panel: ArmedPanel): void {
  armed.delete(panel);
}

/**
 * Whether this panel is the one that answers a click.
 *
 * The first to arm answers, and passes the destination to the rest through
 * `nextAfter`. Any other rule lets two dialogs open over one click.
 */
export function answers(panel: ArmedPanel): boolean {
  return armed.values().next().value === panel;
}

/**
 * The next panel still holding unsaved work, or undefined when nobody is left
 * and the navigation may happen.
 *
 * `panel` may still be in the set: the hook's effect tears down after the
 * commit that cleared `when`, and a dialog calls this during that window. So it
 * is skipped by identity rather than assumed gone — otherwise the panel that
 * just saved would be handed its own destination and ask itself.
 */
export function nextAfter(panel: ArmedPanel | null): ArmedPanel | undefined {
  return [...armed].find((other) => other !== panel);
}

/** Module-level state outlives a test file; each case starts from empty. */
export function resetArmedForTests(): void {
  armed.clear();
}
