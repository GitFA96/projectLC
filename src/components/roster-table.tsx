"use client";

import * as React from "react";
import { format, parseISO } from "date-fns";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { CharacterLink, ClassBadge } from "@/components/class-badge";
import { RoleBadge } from "@/components/role-badge";
import { PhasePills } from "@/components/phase-pills";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ROLES, WOW_CLASSES, type CharacterStatus } from "@/lib/constants/wow";
import type { Phase, Role, WowClass } from "@/lib/types";

export interface RosterRow {
  name: string;
  wowClass: WowClass;
  spec: string;
  role: Role;
  status: CharacterStatus;
  completions: { phase: Phase; pct: number }[];
  totalAwards: number;
  activePhaseAwards: number;
  offspecAwards: number;
  lastAwardAt?: string;
  hasCurrentGear: boolean;
}

export function RosterTable({ rows, activePhase }: { rows: RosterRow[]; activePhase: Phase }) {
  const [classFilter, setClassFilter] = React.useState<string>("all");
  const [roleFilter, setRoleFilter] = React.useState<string>("all");

  const filtered = React.useMemo(
    () =>
      rows.filter(
        (r) =>
          (classFilter === "all" || r.wowClass === classFilter) &&
          (roleFilter === "all" || r.role === roleFilter),
      ),
    [rows, classFilter, roleFilter],
  );

  const columns = React.useMemo<ColumnDef<RosterRow, unknown>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: "Character",
        cell: ({ row }) => (
          <span className="flex items-center gap-1.5">
            <CharacterLink name={row.original.name} wowClass={row.original.wowClass} />
            {row.original.status === "alt" && <Badge variant="muted">alt</Badge>}
            {!row.original.hasCurrentGear && (
              <Badge variant="warning" title="No current gear imported">
                no gear
              </Badge>
            )}
          </span>
        ),
      },
      {
        id: "class",
        accessorKey: "wowClass",
        header: "Class & spec",
        cell: ({ row }) => <ClassBadge wowClass={row.original.wowClass} spec={row.original.spec} />,
      },
      {
        id: "role",
        accessorKey: "role",
        header: "Role",
        cell: ({ row }) => <RoleBadge role={row.original.role} />,
      },
      {
        id: "wishlists",
        header: "Wishlist progress",
        enableSorting: false,
        cell: ({ row }) => (
          <PhasePills items={row.original.completions} activePhase={activePhase} />
        ),
      },
      {
        id: "awards",
        accessorKey: "totalAwards",
        header: "Items won",
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.totalAwards}
            <span className="text-xs text-muted-foreground">
              {" "}
              ({row.original.activePhaseAwards} this phase
              {row.original.offspecAwards > 0 ? `, ${row.original.offspecAwards} OS` : ""})
            </span>
          </span>
        ),
      },
      {
        id: "lastAward",
        accessorKey: "lastAwardAt",
        header: "Last award",
        cell: ({ row }) =>
          row.original.lastAwardAt ? (
            <span className="text-sm tabular-nums text-muted-foreground">
              {format(parseISO(row.original.lastAwardAt), "d MMM yyyy")}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          ),
      },
    ],
    [activePhase],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={classFilter} onValueChange={setClassFilter}>
          <SelectTrigger className="w-36">
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
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            {ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length} of {rows.length} characters
        </span>
      </div>
      <div className="rounded-xl border bg-card">
        <DataTable
          columns={columns}
          data={filtered}
          initialSorting={[{ id: "name", desc: false }]}
          emptyMessage="No characters match the filters."
        />
      </div>
    </div>
  );
}
