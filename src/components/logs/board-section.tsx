"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "1 raider", "13 raiders". Only ever used for the section counts here, so it
 * takes the plural form rather than guessing at English — "instances" is a
 * suffix but "raiders" and "pulls" would still need the caller to be careful,
 * and one signature that is always right beats three that are usually right.
 */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * A titled block inside a card that holds several of them, folded away behind
 * its own heading.
 *
 * Exists because the dispel and interrupt boards were each three separate
 * `CollapsibleCard`s before they were folded into one card with two tabs. That
 * left three full sections stacked inside every tab — a per-pull timeline for
 * every boss of the night under a table under another table — which is a very
 * long scroll for a card somebody opened to check one thing.
 *
 * **Folds, not a third row of tabs.** Two of these sections already contain
 * their own per-fight `Tabs`, so a tab strip here would put three levels of
 * them on screen at once with no way to tell which row moves what.
 *
 * It lives in its own file rather than beside the wrapper that renders it: the
 * wrapper imports the two boards and the two boards import this, so putting it
 * there would close the loop.
 *
 * The heading is an `h3` because the card's own title is the `h2` above it.
 */
export function BoardSection({
  title,
  /**
   * A count or summary shown beside the title, and the reason a closed section
   * is still worth reading: "2 instances · 432 dispels" tells an officer
   * whether to open it. A section that says only its own name makes you open
   * all three to find the one you wanted.
   */
  meta,
  description,
  defaultOpen = false,
  children,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  description?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <section className="border-b border-border/60 pb-3 last:border-b-0 last:pb-0">
      <div
        className="flex cursor-pointer select-none items-baseline gap-1.5"
        onClick={() => setOpen((o) => !o)}
        role="button"
        aria-expanded={open}
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 self-center text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
          aria-hidden
        />
        <h3 className="font-medium leading-none">{title}</h3>
        {meta && <span className="text-xs tabular-nums text-muted-foreground">{meta}</span>}
      </div>
      {/*
        The description belongs to the open state. It is two or three lines of
        why-this-is-shaped-this-way on every section, and three of those stacked
        above three closed headings is the wall of text the fold exists to
        remove.
      */}
      {open && (
        <div className="space-y-2 pt-2">
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
          {children}
        </div>
      )}
    </section>
  );
}
