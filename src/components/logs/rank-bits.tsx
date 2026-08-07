import Link from "next/link";
import { CLASS_TEXT_COLORS } from "@/lib/constants/wow";
import type { WowClass } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Small presentational bits shared by the raid-log rankings — server boards and
 * the client consumable leaderboard both render these, so they live in a plain
 * (non-"use client") module and stay pure.
 */

export function classColor(className?: string): string | undefined {
  return className && className in CLASS_TEXT_COLORS
    ? CLASS_TEXT_COLORS[className as WowClass]
    : undefined;
}

/** Class-colored raider name, linking matched roster characters to their logs. */
export function Raider({ name, slug, className }: { name: string; slug?: string; className?: string }) {
  const color = classColor(className);
  if (slug) {
    return (
      <Link
        href={`/characters/${encodeURIComponent(slug)}/performance`}
        className="font-medium hover:underline"
        style={color ? { color } : undefined}
      >
        {name}
      </Link>
    );
  }
  return (
    <span className="font-medium" style={color ? { color } : undefined} title="Not matched to a roster character">
      {name}
    </span>
  );
}

/** 1/2/3 podium pip; muted number after the podium. */
export function RankBadge({ rank }: { rank: number }) {
  const tone =
    rank === 1
      ? "bg-medal-gold text-medal-gold-ink"
      : rank === 2
        ? "bg-medal-silver text-medal-silver-ink"
        : rank === 3
          ? "bg-medal-bronze text-medal-bronze-ink"
          : "bg-muted text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
        tone,
      )}
    >
      {rank}
    </span>
  );
}

/** "What they used" — every item as a badge, wrapping down (no truncation). */
export function BreakdownBadges({
  items,
}: {
  /** `delta` marks a line an officer moved by hand — flagged, never silent. */
  items: { name: string; count: number; delta?: number; added?: boolean }[];
}) {
  if (items.length === 0) return <span className="text-xs text-muted-foreground/50">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((it) => (
        <Badge
          key={it.name}
          variant={it.delta === undefined ? "secondary" : "warning"}
          className="font-normal"
          title={
            it.delta === undefined
              ? undefined
              : `${it.added ? "Added by hand" : "Adjusted by hand"}: ${it.delta > 0 ? "+" : "−"}${Math.abs(it.delta)} use${Math.abs(it.delta) === 1 ? "" : "s"}`
          }
        >
          {it.name}
          {it.count > 1 && <span className="ml-1 opacity-70">×{it.count}</span>}
          {it.delta !== undefined && (
            <span className="ml-1 font-medium">({it.delta > 0 ? "+" : "−"}{Math.abs(it.delta)})</span>
          )}
        </Badge>
      ))}
    </span>
  );
}

/** Zero shown muted so the ranked columns stay scannable. */
export function Tally({ n }: { n: number }) {
  return n > 0 ? <>{n}</> : <span className="text-muted-foreground/40">0</span>;
}
