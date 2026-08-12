"use server";

import { redirect } from "next/navigation";
import { currentAccount, endSession } from "@/lib/auth/session";
import { authEnabled, resolveViewer } from "@/lib/auth/viewer";
import { permits, ROUTE_NEEDS } from "@/lib/auth/view";

/**
 * The signed-in person, as the chrome needs to know them.
 *
 * Deliberately a server action rather than something the layout resolves.
 * Reading the session cookie in a layout opts **every page** out of static
 * rendering, and an account menu is not a good enough reason to change how the
 * whole app renders. Read gating (step 10 of the plan) is where that question
 * gets decided properly.
 */

/**
 * Sign out.
 *
 * A server action rather than a GET route on purpose: a link that ends a
 * session can be triggered by anything that renders a URL — an `<img>` in a
 * comment, a prefetch, a chat unfurl. Actions are POSTs with Next's own origin
 * check, so signing out takes a deliberate click.
 *
 * `endSession` revokes the row before clearing the cookie, which is what makes
 * this useful to somebody signing out *because* they think the cookie leaked.
 */
export async function signOutAction(): Promise<void> {
  await endSession();
  redirect("/signin");
}

export interface Whoami {
  signedIn: boolean;
  /**
   * Which nav destinations this viewer can actually reach.
   *
   * The nav asks rather than deciding for itself, because "can they see this"
   * is `pageView`'s answer and duplicating the rule in a client component is
   * how the two drift apart. Hiding a link is presentation — the page refuses
   * on its own regardless, which is what makes this safe to get wrong.
   */
  reachable: string[];
  /** Their Discord name. Null when signed out. */
  displayName: string | null;
  /** Operates the service. Grants nothing inside any guild — see §7. */
  appAdmin: boolean;
  /**
   * Whether capability checks are being enforced at all. The menu says so,
   * because "signed in" and "it matters that you are signed in" are different
   * facts and confusing them is how somebody assumes they are protected.
   */
  enforcing: boolean;
}

/**
 * Who is this browser?
 *
 * Reads only the caller's own cookie and answers only about them, so there is
 * nothing here for one person to learn about another.
 */
export async function whoAmI(): Promise<Whoami> {
  const [account, viewer] = await Promise.all([currentAccount(), resolveViewer()]);
  return {
    signedIn: account !== null,
    displayName: account?.discordUsername ?? null,
    appAdmin: account?.appAdmin ?? false,
    enforcing: authEnabled(),
    reachable: Object.entries(ROUTE_NEEDS)
      .filter(([, need]) => permits(viewer, need))
      .map(([href]) => href),
  };
}
