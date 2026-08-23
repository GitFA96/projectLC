import { redirect } from "next/navigation";
import { can, isAppAdmin } from "@/lib/auth/can";
import { resolveViewer, type Viewer } from "@/lib/auth/viewer";
import { CAPABILITIES, isCapability, type Capability } from "@/lib/auth/capabilities";

/**
 * What a page needs before it renders.
 *
 * **Every `page.tsx` calls this exactly once, at the top.** `pages.test.ts`
 * enumerates them and fails when one does not, which is the deny-by-default
 * property: a new page that forgets is a red build rather than a page that
 * quietly serves the guild's ledger to anybody.
 *
 * ## Why here and not in the repo
 *
 * The plan of record said `getRepo(viewer)` — a repo that filters by who is
 * asking. That is the same mistake §6 of the design doc already argues against
 * for pages, moved down a layer: ~200 methods each having to remember, where
 * the next one added is open until somebody notices. It would also drag
 * authorization into `createRepoFromStore`, which is shared with the seed
 * backend and whose entire value is having no idea who is asking.
 *
 * One declaration per page is 28 decisions instead of 200, each visible in one
 * place and each named in a test. What a *filtering* repo would have bought —
 * safety when somebody forgets — the test buys instead.
 *
 * ## What this is not
 *
 * Not a substitute for the checks on writes. A page gate decides what renders;
 * `requireCapability` in the server action decides what happens. Both, always:
 * hiding a page does not stop a POST.
 */

/**
 * `"public"` — anyone, signed in or not. Say it out loud; the test will not
 * accept silence.
 * `"member"` — any member of this guild, whatever their roles.
 * `"app-admin"` — operates the service. Grants nothing inside a guild (§7).
 * A capability — a member holding that specific grant.
 */
export type ViewNeed = "public" | "member" | "app-admin" | Capability;

/**
 * What each navigable route needs, in one place.
 *
 * A mirror of the `pageView()` call on each page rather than the source of
 * truth — the page is. Two consumers read it: the nav, to avoid offering doors
 * that shut in somebody's face, and the permissions preview, to show a guild
 * who can reach what. If it disagrees with a page the result is merely wrong,
 * never permissive: the page refuses on its own regardless.
 */
export const ROUTE_NEEDS: Record<string, ViewNeed> = {
  "/": "public",
  "/roster": "roster.view",
  "/roster/standing": "roster.view",
  "/roster/members": "members.manage",
  "/compare": "roster.view",
  "/guild/roles": "roles.manage",
  "/guild/import": "import.run",
  "/guild/preview": "roles.manage",
  "/guild/audit": "guild.view",
  "/loot": "loot.view",
  "/loot/plan": "loot.award",
  "/loot/priority": "priority.view",
  "/items": "loot.view",
  "/logs": "logs.view",
  "/raid-planner": "raid.plan",
  "/fight-graph": "logs.view",
  "/sim": "logs.view",
  "/guides": "guild.view",
  "/guides/raids": "guild.view",
  "/service": "app-admin",
  "/service/drops": "app-admin",
  "/service/tenancy": "app-admin",
  "/service/feedback": "app-admin",
};

export interface ViewVerdict {
  viewer: Viewer;
  allowed: boolean;
  need: ViewNeed;
  /** Officer-facing copy for the denial page. */
  reason: string;
}

function describe(need: ViewNeed): string {
  if (need === "public") return "";
  if (need === "member") return "This page is for members of this guild.";
  if (need === "app-admin") return "This page is part of running the service, not any one guild.";
  return isCapability(need)
    ? `This page needs the “${CAPABILITIES[need].label}” permission.`
    : "This page needs a permission you don't have.";
}

/**
 * The rule, exported so the nav can ask the same question the page will.
 * Duplicating it in a client component is how the two drift apart — and the
 * drift is invisible, because a wrong nav still lands on a page that refuses.
 */
export function permits(viewer: Viewer, need: ViewNeed): boolean {
  if (need === "public") return true;
  if (need === "app-admin") return isAppAdmin(viewer);
  if (need === "member") return viewer.unrestricted || viewer.guild !== null;
  return can(viewer, need);
}

/**
 * Declare what this page needs, and get the viewer back.
 *
 * A signed-out visitor who needs more than `"public"` is **redirected to sign
 * in**, carrying where they were headed — they are not shown a denial, because
 * signing in may well be the answer. Somebody already signed in gets a verdict
 * back instead: they know this guild exists, they are standing in it, and a 404
 * would read as the site being broken rather than as a permission they lack.
 *
 * `redirect()` throws, so the signed-out path never returns.
 */
export async function pageView(need: ViewNeed, options?: { returnTo?: string }): Promise<ViewVerdict> {
  const viewer = await resolveViewer();
  const allowed = permits(viewer, need);
  if (allowed) return { viewer, allowed, need, reason: "" };

  if (viewer.accountId === null) {
    const returnTo = options?.returnTo;
    redirect(`/signin${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`);
  }
  return { viewer, allowed: false, need, reason: describe(need) };
}
