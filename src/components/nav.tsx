"use client";

import Link from "next/link";
import * as React from "react";
import { usePathname } from "next/navigation";
import { Swords } from "lucide-react";
import { whoAmI } from "@/app/account-actions";
import { AccountMenu } from "@/components/account-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

/**
 * "Guild" rather than "Dashboard": the page is the guild's own profile —
 * identity, season standing and loot policy — and naming it after the subject
 * rather than the layout is what survives the move to many guilds. See
 * docs/guild-and-player-profiles.md.
 */
/**
 * Five sections, each owning its own pages.
 *
 * Eleven flat links had outgrown the bar, and the pages divide cleanly by the
 * question being asked rather than by what they're built from. Deliberately NOT
 * dropdowns: a hover menu hides the destination, is awkward on touch, and this
 * app already answers "where am I" with in-page tabs on /logs and /sim. So the
 * second row is a plain sub-nav for whichever section you're in — always
 * visible, never a surprise.
 *
 * A section with one page shows no second row; there is nothing to choose.
 */
interface Section {
  href: string;
  label: string;
  pages?: { href: string; label: string }[];
  /** Paths the section owns without listing — detail pages reached from it. */
  owns?: string[];
}

const SECTIONS: Section[] = [
  {
    href: "/",
    label: "Guild",
    pages: [
      { href: "/", label: "Guild" },
      { href: "/guild/roles", label: "Roles" },
      { href: "/guild/import", label: "Import" },
      { href: "/guild/preview", label: "Permissions" },
      { href: "/guild/audit", label: "Audit" },
    ],
    owns: ["/guild"],
  },
  {
    href: "/roster",
    label: "Roster",
    pages: [
      { href: "/roster", label: "Roster" },
      { href: "/roster/standing", label: "Standing" },
      { href: "/roster/members", label: "Members" },
      { href: "/compare", label: "Compare" },
    ],
    // A character profile is reached from the roster and belongs to it, but it
    // is nobody's nav destination — the section stays lit, the row stays short.
    owns: ["/characters"],
  },
  {
    href: "/loot",
    label: "Loot",
    pages: [
      { href: "/loot", label: "Ledger" },
      { href: "/loot/plan", label: "Loot plan" },
      { href: "/loot/priority", label: "Priority sheet" },
      { href: "/items", label: "Items" },
    ],
  },
  {
    href: "/logs",
    label: "Raids",
    pages: [
      { href: "/logs", label: "Raid logs" },
      { href: "/raid-planner", label: "Raid planner" },
      { href: "/fight-graph", label: "Fight graph" },
      { href: "/sim", label: "Sim" },
    ],
  },
  { href: "/guides", label: "Guides" },
  /*
   * Running the service, not running a guild.
   *
   * Import used to live here, which put a guild's own business behind a tab
   * called Admin and implied an operator ran it. It is guild work — whoever
   * holds `import.run` — so it sits with the guild's other pages now.
   *
   * Nav-by-capability hides this section entirely from anybody who is not an
   * app admin, so most people never learn it exists.
   */
  {
    href: "/service",
    label: "Service",
    pages: [
      { href: "/service", label: "Overview" },
      { href: "/service/tenancy", label: "Tenancy" },
      { href: "/service/feedback", label: "Feedback" },
    ],
  },
];

/**
 * Routes that are not inside the guild yet.
 *
 * Somebody redeeming an invite is not a member — they are a person holding a
 * code, deciding whether to accept. Wrapping that in the guild's own chrome,
 * Admin link and all, claims a belonging they do not have yet and offers
 * navigation they cannot use.
 *
 * Done here rather than with an `(auth)` route group because the nav lives in
 * the **root** layout: a nested layout cannot remove its parent's chrome, so
 * the route-group version means moving every existing route into an `(app)`
 * group. That is a large mechanical change to buy what one already-available
 * pathname buys.
 *
 * This is presentation, not protection. What an unregistered visitor may
 * *read* is a different question, and it is answered by read gating — hiding
 * links to pages that still serve their data would only be a lie in the other
 * direction. See docs/guild-and-player-profiles.md §5, §9 step 8.
 */
const OUTSIDE_THE_GUILD = ["/signin", "/join", "/claim"];

/**
 * Which section a path belongs to. Some pages don't live under their section's
 * own href (/compare is Roster's, /items is Loot's), so a section owns a path
 * when the path starts with the section href OR with any of its pages'.
 */
function sectionFor(pathname: string): Section | undefined {
  if (pathname === "/") return SECTIONS[0];
  return SECTIONS.filter((s) => s.href !== "/").find(
    (s) =>
      pathname.startsWith(s.href) ||
      (s.owns ?? []).some((o) => pathname.startsWith(o)) ||
      (s.pages ?? []).some((p) => pathname === p.href || pathname.startsWith(`${p.href}/`)),
  );
}

export function Nav({
  guildName,
  realm,
}: {
  /** Null for somebody who is not in this guild — see the note in layout.tsx. */
  guildName: string | null;
  realm: string | null;
}) {
  const pathname = usePathname();
  const [reachable, setReachable] = React.useState<Set<string> | null>(null);

  /*
   * Which links to show, asked of the server rather than decided here.
   *
   * A client component cannot resolve a session, and re-implementing the rule
   * from a prop would be a second copy of it that drifts. Asked after mount for
   * the same reason the account menu is: resolving the viewer in `layout.tsx`
   * reads a cookie during render and would opt every page out of static
   * rendering — which read gating has now done anyway, but through a decision
   * rather than a side effect.
   *
   * **Hiding a link is presentation, never protection.** Until the answer
   * arrives every section renders, and that is fine: the page it points at
   * refuses on its own. This only stops officers being offered doors that shut
   * in their face.
   */
  React.useEffect(() => {
    let live = true;
    whoAmI()
      .then((me) => {
        if (live) setReachable(new Set(me.reachable));
      })
      .catch(() => {
        // No answer is not "nothing is reachable" — showing an empty nav on a
        // failed request would read as the app being broken.
      });
    return () => {
      live = false;
    };
  }, [pathname]);

  const visible = (href: string) => reachable === null || reachable.has(href);
  if (OUTSIDE_THE_GUILD.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;

  const current = sectionFor(pathname);
  const pages = current?.pages?.filter((p) => visible(p.href));
  // Longest match wins, so a section index (/admin) doesn't stay lit while you
  // are on a page beneath it (/admin/import). Plain `startsWith` lights both.
  const activePage = pages
    ?.filter((p) => pathname === p.href || pathname.startsWith(`${p.href}/`))
    .reduce<string | undefined>(
      (best, p) => (best === undefined || p.href.length > best.length ? p.href : best),
      undefined,
    );
  return (
    <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Swords className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold leading-tight">
            {guildName ?? "projectLC"}
            {realm && (
              <span className="block text-[11px] font-normal text-muted-foreground">{realm}</span>
            )}
          </span>
        </Link>
        <nav className="flex items-center gap-1 text-sm" aria-label="Sections">
          {SECTIONS.filter((section) =>
            section.pages ? section.pages.some((p) => visible(p.href)) : visible(section.href),
          ).map((section) => (
            <Link
              key={section.href}
              href={section.pages?.find((p) => visible(p.href))?.href ?? section.href}
              className={cn(
                "rounded-md px-3 py-1.5 font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                section === current && "bg-accent text-foreground",
              )}
              aria-current={section === current ? "page" : undefined}
            >
              {section.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <ThemeToggle />
          <AccountMenu />
        </div>
      </div>

      {pages && pages.length > 0 && (
        <div className="border-t bg-card/60">
          <nav
            className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-4 py-1.5 text-sm"
            aria-label={`${current?.label} pages`}
          >
            {pages.map((page) => {
              const active = page.href === activePage;
              return (
                <Link
                  key={page.href}
                  href={page.href}
                  className={cn(
                    "shrink-0 rounded-md px-2.5 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                    active && "bg-accent font-medium text-foreground",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  {page.label}
                </Link>
              );
            })}
          </nav>
        </div>
      )}
    </header>
  );
}
