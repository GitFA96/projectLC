"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Swords } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { QuickSearch } from "@/components/quick-search";
import { ThemeToggle } from "@/components/theme-toggle";
import type { QuickSearchItem } from "@/lib/analysis/quick-search";
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
  { href: "/", label: "Guild" },
  {
    href: "/roster",
    label: "Roster",
    pages: [
      { href: "/roster", label: "Roster" },
      { href: "/roster/standing", label: "Standing" },
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
  {
    href: "/admin",
    label: "Admin",
    pages: [
      { href: "/admin", label: "Overview" },
      { href: "/admin/import", label: "Import" },
      { href: "/admin/feedback", label: "Feedback" },
    ],
  },
];

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
  activePhase,
  searchItems,
}: {
  guildName: string;
  realm: string;
  activePhase: number;
  searchItems: QuickSearchItem[];
}) {
  const pathname = usePathname();
  const current = sectionFor(pathname);
  const pages = current?.pages;
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
            {guildName}
            <span className="block text-[11px] font-normal text-muted-foreground">{realm}</span>
          </span>
        </Link>
        <nav className="flex items-center gap-1 text-sm" aria-label="Sections">
          {SECTIONS.map((section) => (
            <Link
              key={section.href}
              href={section.pages?.[0].href ?? section.href}
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
          <QuickSearch items={searchItems} />
          <Badge variant="outline" className="gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            Phase {activePhase} active
          </Badge>
          <ThemeToggle />
        </div>
      </div>

      {pages && (
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
