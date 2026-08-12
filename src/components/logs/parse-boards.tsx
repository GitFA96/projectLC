"use client";

import * as React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Raider } from "@/components/logs/rank-bits";
import { SpecBadge } from "@/components/spec-badge";
import { parseColor } from "@/components/parse-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ParseBoard, ParseBoardCell } from "@/lib/types";
import { cn } from "@/lib/utils";

import { compareText } from "@/lib/sort";

/**
 * The night's parses as a grid — one table per role, a column per boss kill,
 * in the shape Warcraft Logs' own rankings view uses.
 *
 * Built to be scanned rather than clicked: names down the left in class
 * colour, the average they'll argue about right next to it, and a percentile
 * per kill coloured on WCL's scale. A blank cell means they weren't ranked on
 * that kill (absent, or dead early enough not to place) — never a zero, which
 * would read as a bad parse.
 *
 * Damage boards carry two percentiles per pull: all damage, and damage to the
 * boss alone. They're genuinely different numbers, so the board switches
 * between them instead of repeating every raider in a second table.
 */
export function ParseBoards({ boards }: { boards: ParseBoard[] }) {
  if (boards.length === 0) return null;
  return (
    <div className="space-y-4">
      {boards.map((board) => (
        <ParseBoardCard key={board.key} board={board} />
      ))}
    </div>
  );
}

function fmtDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** "Hydross: 94 · bracket 88 · 1,354 · Fury" — the detail behind one cell. */
function cellTitle(encounterName: string, cell: ParseBoardCell, boss: boolean): string {
  const parse = boss ? cell.bossParse : cell.parse;
  const amount = boss ? cell.bossAmount : cell.amount;
  return [
    `${encounterName}: ${Math.round(parse ?? 0)}${boss ? " on boss damage" : ""}`,
    !boss && cell.bracket !== undefined ? `bracket ${Math.round(cell.bracket)}` : undefined,
    amount !== undefined ? Math.round(amount).toLocaleString("en-US") : undefined,
    cell.spec,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Which column orders the board, and which way. */
type Sort = { by: "avg" | "name"; dir: "asc" | "desc" };

function ParseBoardCard({ board }: { board: ParseBoard }) {
  const [boss, setBoss] = React.useState(false);
  const [sort, setSort] = React.useState<Sort>({ by: "avg", dir: "desc" });
  const showBoss = boss && board.bossMetric !== undefined;
  const byActor = new Map(
    board.rows.map((row) => [row.name, new Map(row.cells.map((c) => [c.fightId, c] as const))] as const),
  );

  /** Click the header you want to order by; click it again to flip direction. */
  const sortBy = (by: Sort["by"]) =>
    setSort((current) =>
      current.by === by
        ? { by, dir: current.dir === "asc" ? "desc" : "asc" }
        : { by, dir: by === "name" ? "asc" : "desc" },
    );

  const rows = [...board.rows].sort((a, b) => {
    if (sort.by === "name") {
      const byName = compareText(a.name, b.name);
      return sort.dir === "asc" ? byName : -byName;
    }
    // The average follows the metric on screen — it's the column people read.
    const av = showBoss ? a.bossAvg : a.avg;
    const bv = showBoss ? b.bossAvg : b.avg;
    // Unranked raiders sit at the bottom either way: they have nothing to rank.
    if (av === undefined || bv === undefined) {
      return (av === undefined ? 1 : 0) - (bv === undefined ? 1 : 0) || compareText(a.name, b.name);
    }
    return (sort.dir === "desc" ? bv - av : av - bv) || compareText(a.name, b.name);
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{board.label}</CardTitle>
          {board.bossMetric && (
            <div className="inline-flex overflow-hidden rounded-md border text-xs">
              <MetricButton active={!showBoss} onClick={() => setBoss(false)}>
                All damage
              </MetricButton>
              <MetricButton active={showBoss} onClick={() => setBoss(true)}>
                Boss damage
              </MetricButton>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Percentile per boss kill — {showBoss ? board.bossMetric : board.metric}. Average is over
          the kills they were ranked on ({board.rows.length} raider
          {board.rows.length === 1 ? "" : "s"}, {board.columns.length} kill
          {board.columns.length === 1 ? "" : "s"}).
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-card px-2 py-1.5 text-left text-xs font-medium text-muted-foreground">
                  <SortHeader sort={sort} column="name" onClick={() => sortBy("name")}>
                    Name
                  </SortHeader>
                </th>
                <th className="px-2 py-1.5 text-right text-xs font-medium text-muted-foreground">
                  <SortHeader sort={sort} column="avg" onClick={() => sortBy("avg")} align="right">
                    Avg
                  </SortHeader>
                </th>
                {board.columns.map((column) => (
                  <th
                    key={column.fightId}
                    className="px-2 py-1.5 text-left text-xs font-medium text-muted-foreground"
                    title={column.encounterName}
                  >
                    <span className="block max-w-24 truncate">{column.encounterName}</span>
                    <span className="block tabular-nums opacity-70">
                      {fmtDuration(column.durationMs)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const cells = byActor.get(row.name);
                const avg = showBoss ? row.bossAvg : row.avg;
                const ranked = showBoss ? row.bossRanked : row.ranked;
                return (
                  <tr key={row.name} className="border-t hover:bg-muted/40">
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-card px-2 py-1">
                      <span className="flex items-center gap-1.5">
                        <Raider name={row.name} slug={row.slug} className={row.className} />
                        {row.spec && (
                          <SpecBadge
                            spec={row.spec}
                            wowClass={row.className}
                            title={`${row.spec} — the spec they played most of the night`}
                            iconOnly
                          />
                        )}
                      </span>
                    </td>
                    <td
                      className="px-2 py-1 text-right font-semibold tabular-nums"
                      style={avg !== undefined ? { color: parseColor(avg) } : undefined}
                      title={`Average of ${ranked} ranked kill${ranked === 1 ? "" : "s"}`}
                    >
                      {avg ?? "—"}
                    </td>
                    {board.columns.map((column) => {
                      const cell = cells?.get(column.fightId);
                      const parse = cell && (showBoss ? cell.bossParse : cell.parse);
                      return (
                        <td key={column.fightId} className="px-2 py-1 tabular-nums">
                          {cell && parse !== undefined ? (
                            <span
                              className="font-medium"
                              style={{ color: parseColor(parse) }}
                              title={cellTitle(column.encounterName, cell, showBoss)}
                            >
                              {Math.round(parse)}
                            </span>
                          ) : (
                            <span
                              className="text-muted-foreground/40"
                              title={
                                cell
                                  ? "No boss-damage parse on this kill"
                                  : "Not ranked on this kill"
                              }
                            >
                              -
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * A sortable column heading: by average (the ranking read) or by name (the
 * "where am I on this list" read). The arrow only shows on the active column,
 * so the board still says at a glance what it's ordered by.
 */
function SortHeader({
  sort,
  column,
  onClick,
  align = "left",
  children,
}: {
  sort: Sort;
  column: Sort["by"];
  onClick: () => void;
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  const active = sort.by === column;
  const Arrow = sort.dir === "asc" ? ChevronUp : ChevronDown;
  return (
    <button
      type="button"
      onClick={onClick}
      title={column === "name" ? "Sort alphabetically" : "Sort by average parse"}
      className={cn(
        "inline-flex items-center gap-0.5 hover:text-foreground",
        align === "right" && "flex-row-reverse",
        active && "text-foreground",
      )}
    >
      {children}
      <Arrow className={cn("h-3 w-3", active ? "opacity-100" : "opacity-0")} />
    </button>
  );
}

function MetricButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "px-2 py-1 transition-colors",
        active ? "bg-primary text-primary-foreground" : "hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}
