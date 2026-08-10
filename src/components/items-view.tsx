"use client";

import * as React from "react";
import { format, parseISO } from "date-fns";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { ItemLink } from "@/components/item-link";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PHASES } from "@/lib/constants/wow";
import type { Phase, Quality } from "@/lib/types";

export interface ItemDemandRow {
  itemId: number;
  name: string;
  quality?: Quality;
  icon?: string;
  slotLabel?: string;
  /** "Boss — Zone" when known. */
  source?: string;
  phase?: Phase;
  wisherCount: number;
  openCount: number;
  awardCount: number;
  lastAwardedAt?: string;
}

/**
 * The "something just dropped" lookup: search the item, scan demand at a
 * glance, click through for the full contention view.
 */
export function ItemsView({ rows }: { rows: ItemDemandRow[] }) {
  const [search, setSearch] = React.useState("");
  const [phaseFilter, setPhaseFilter] = React.useState("all");
  const [demandFilter, setDemandFilter] = React.useState("all");

  const filtered = React.useMemo(
    () =>
      rows.filter((r) => {
        if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false;
        if (phaseFilter !== "all" && String(r.phase ?? "") !== phaseFilter) return false;
        if (demandFilter === "wishlisted" && r.wisherCount === 0) return false;
        if (demandFilter === "open" && r.openCount === 0) return false;
        if (demandFilter === "contested" && r.wisherCount < 2) return false;
        return true;
      }),
    [rows, search, phaseFilter, demandFilter],
  );

  const columns = React.useMemo<ColumnDef<ItemDemandRow, unknown>[]>(
    () => [
      {
        id: "item",
        accessorKey: "name",
        header: "Item",
        cell: ({ row }) => (
          <ItemLink
            item={{
              itemId: row.original.itemId,
              name: row.original.name,
              quality: row.original.quality,
              icon: row.original.icon,
            }}
          />
        ),
      },
      {
        id: "slot",
        accessorKey: "slotLabel",
        header: "Slot",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{row.original.slotLabel ?? "—"}</span>
        ),
      },
      {
        id: "source",
        accessorKey: "source",
        header: "Source",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="block max-w-52 truncate text-sm text-muted-foreground" title={row.original.source}>
            {row.original.source ?? "—"}
          </span>
        ),
      },
      {
        id: "phase",
        accessorFn: (row) => row.phase ?? 0,
        header: "Phase",
        cell: ({ row }) =>
          row.original.phase ? (
            <Badge variant="secondary">P{row.original.phase}</Badge>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "want",
        accessorKey: "wisherCount",
        header: "Want",
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">
            {row.original.wisherCount > 0 ? row.original.wisherCount : <span className="text-muted-foreground/50">0</span>}
          </span>
        ),
      },
      {
        id: "open",
        accessorKey: "openCount",
        header: "Open",
        cell: ({ row }) =>
          row.original.openCount > 0 ? (
            <Badge variant="warning" className="tabular-nums">{row.original.openCount}</Badge>
          ) : (
            <span className="text-sm tabular-nums text-muted-foreground/50">0</span>
          ),
      },
      {
        id: "won",
        accessorKey: "awardCount",
        header: "Awarded",
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">
            {row.original.awardCount > 0 ? row.original.awardCount : <span className="text-muted-foreground/50">0</span>}
          </span>
        ),
      },
      {
        id: "last",
        accessorKey: "lastAwardedAt",
        header: "Last drop",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">
            {row.original.lastAwardedAt ? format(parseISO(row.original.lastAwardedAt), "d MMM yyyy") : "—"}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search item…"
          className="h-8 w-56"
          autoFocus
        />
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
        <Select value={demandFilter} onValueChange={setDemandFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Demand" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All items</SelectItem>
            <SelectItem value="wishlisted">Wishlisted</SelectItem>
            <SelectItem value="open">Open demand</SelectItem>
            <SelectItem value="contested">Contested (2+ want)</SelectItem>
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {filtered.length} of {rows.length} items
        </span>
      </div>

      <div className="rounded-xl border bg-card">
        <DataTable
          columns={columns}
          data={filtered}
          resetPageOn={[search, phaseFilter, demandFilter].join("|")}
          initialSorting={[{ id: "open", desc: true }]}
          emptyMessage="No items match the filters."
        />
      </div>
    </div>
  );
}
