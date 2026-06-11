"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { format, parseISO } from "date-fns";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { ItemLink, type ItemRef } from "@/components/item-link";
import { CharacterLink } from "@/components/class-badge";
import { ResolveAwardControl } from "@/components/resolve-award";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PHASES, WOW_CLASSES } from "@/lib/constants/wow";
import type { Phase, WowClass } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface LootRow {
  id: string;
  awardedAt: string;
  sessionId: string;
  sessionLabel: string;
  phase?: Phase;
  item: ItemRef;
  winnerName: string;
  winnerClass?: WowClass;
  /** roster = matched character; unresolved = needs attention; external = settled off-roster. */
  winnerStatus: "roster" | "unresolved" | "external";
  offspec: boolean;
  matched: boolean;
  matchPhases: Phase[];
  note?: string;
}

export interface SessionOption {
  id: string;
  label: string;
  date: string;
  count: number;
}

export function LootView({
  rows,
  sessions,
  characters,
}: {
  rows: LootRow[];
  sessions: SessionOption[];
  characters: { id: string; name: string; wowClass: WowClass }[];
}) {
  const searchParams = useSearchParams();
  const [search, setSearch] = React.useState("");
  const [characterFilter, setCharacterFilter] = React.useState(
    searchParams.get("character") ?? "all",
  );
  const [classFilter, setClassFilter] = React.useState("all");
  const [phaseFilter, setPhaseFilter] = React.useState("all");
  const [sessionFilter, setSessionFilter] = React.useState(searchParams.get("session") ?? "all");
  const [typeFilter, setTypeFilter] = React.useState("all");
  const [matchFilter, setMatchFilter] = React.useState("all");
  const [winnerFilter, setWinnerFilter] = React.useState(searchParams.get("winner") ?? "all");

  const filtered = React.useMemo(
    () =>
      rows.filter((r) => {
        if (search && !(r.item.name ?? "").toLowerCase().includes(search.toLowerCase())) return false;
        if (characterFilter !== "all" && r.winnerName !== characterFilter) return false;
        if (classFilter !== "all" && r.winnerClass !== classFilter) return false;
        if (phaseFilter !== "all" && String(r.phase ?? "") !== phaseFilter) return false;
        if (sessionFilter !== "all" && r.sessionId !== sessionFilter) return false;
        if (typeFilter === "onspec" && r.offspec) return false;
        if (typeFilter === "offspec" && !r.offspec) return false;
        if (matchFilter === "matched" && !r.matched) return false;
        if (matchFilter === "unmatched" && r.matched) return false;
        if (winnerFilter !== "all" && r.winnerStatus !== winnerFilter) return false;
        return true;
      }),
    [rows, search, characterFilter, classFilter, phaseFilter, sessionFilter, typeFilter, matchFilter, winnerFilter],
  );

  const columns = React.useMemo<ColumnDef<LootRow, unknown>[]>(
    () => [
      {
        id: "date",
        accessorKey: "awardedAt",
        header: "Date",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">
            {format(parseISO(row.original.awardedAt), "d MMM yyyy")}
          </span>
        ),
      },
      {
        id: "item",
        accessorFn: (row) => row.item.name ?? "",
        header: "Item",
        cell: ({ row }) => <ItemLink item={row.original.item} />,
      },
      {
        id: "winner",
        accessorKey: "winnerName",
        header: "Winner",
        cell: ({ row }) => {
          const r = row.original;
          if (r.winnerStatus === "roster") {
            return <CharacterLink name={r.winnerName} wowClass={r.winnerClass ?? "Warrior"} />;
          }
          return (
            <span className="flex items-center gap-1.5">
              <Badge
                variant={r.winnerStatus === "unresolved" ? "warning" : "muted"}
                title={
                  r.winnerStatus === "unresolved"
                    ? "Not matched to a roster character — resolve it"
                    : "Off roster (disenchanted / bank / PUG)"
                }
              >
                {r.winnerName}
              </Badge>
              <ResolveAwardControl awardId={r.id} mode={r.winnerStatus} roster={characters} />
            </span>
          );
        },
      },
      {
        id: "session",
        accessorKey: "sessionLabel",
        header: "Raid",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.sessionLabel}
            {row.original.phase && (
              <span className="ml-1.5 text-xs">P{row.original.phase}</span>
            )}
          </span>
        ),
      },
      {
        id: "type",
        accessorKey: "offspec",
        header: "Type",
        cell: ({ row }) =>
          row.original.offspec ? (
            <Badge variant="warning">Off-spec</Badge>
          ) : (
            <span className="text-xs text-muted-foreground">Main spec</span>
          ),
      },
      {
        id: "wishlist",
        accessorKey: "matched",
        header: "Wishlist",
        cell: ({ row }) =>
          row.original.matched ? (
            <Badge variant="success">
              {row.original.matchPhases.map((p) => `P${p}`).join(", ")} wishlist
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "note",
        accessorKey: "note",
        header: "Note",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="block max-w-48 truncate text-xs text-muted-foreground" title={row.original.note}>
            {row.original.note ?? ""}
          </span>
        ),
      },
    ],
    [characters],
  );

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[200px_1fr]">
      <aside className="hidden space-y-1 lg:block">
        <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">Raid sessions</p>
        <button
          type="button"
          onClick={() => setSessionFilter("all")}
          className={cn(
            "flex w-full cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent",
            sessionFilter === "all" && "bg-accent font-medium",
          )}
        >
          All sessions
          <span className="text-xs tabular-nums text-muted-foreground">{rows.length}</span>
        </button>
        {sessions.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSessionFilter(s.id)}
            className={cn(
              "flex w-full cursor-pointer items-center justify-between gap-1 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent",
              sessionFilter === s.id && "bg-accent font-medium",
            )}
          >
            <span className="min-w-0">
              <span className="block truncate">{s.label}</span>
              <span className="text-xs text-muted-foreground">
                {format(parseISO(s.date), "d MMM yyyy")}
              </span>
            </span>
            <span className="text-xs tabular-nums text-muted-foreground">{s.count}</span>
          </button>
        ))}
      </aside>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search item…"
            className="h-8 w-44"
          />
          <Select value={characterFilter} onValueChange={setCharacterFilter}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Character" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All characters</SelectItem>
              {characters.map((c) => (
                <SelectItem key={c.name} value={c.name}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={classFilter} onValueChange={setClassFilter}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Class" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All classes</SelectItem>
              {WOW_CLASSES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={phaseFilter} onValueChange={setPhaseFilter}>
            <SelectTrigger className="w-28">
              <SelectValue placeholder="Phase" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All phases</SelectItem>
              {PHASES.map((p) => (
                <SelectItem key={p.phase} value={String(p.phase)}>
                  {p.short}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-28">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="onspec">Main spec</SelectItem>
              <SelectItem value="offspec">Off-spec</SelectItem>
            </SelectContent>
          </Select>
          <Select value={matchFilter} onValueChange={setMatchFilter}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Wishlist" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Wishlist: any</SelectItem>
              <SelectItem value="matched">On wishlist</SelectItem>
              <SelectItem value="unmatched">Not on wishlist</SelectItem>
            </SelectContent>
          </Select>
          <Select value={winnerFilter} onValueChange={setWinnerFilter}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Winner" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Winner: any</SelectItem>
              <SelectItem value="roster">On roster</SelectItem>
              <SelectItem value="unresolved">Unresolved</SelectItem>
              <SelectItem value="external">Off roster</SelectItem>
            </SelectContent>
          </Select>
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {filtered.length} of {rows.length} awards
          </span>
        </div>

        <div className="rounded-xl border bg-card">
          <DataTable
            columns={columns}
            data={filtered}
            initialSorting={[{ id: "date", desc: true }]}
            emptyMessage="No awards match the filters."
          />
        </div>
      </div>
    </div>
  );
}
