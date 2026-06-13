"use client";

import * as React from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { Activity } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { CharacterLink, ClassBadge } from "@/components/class-badge";
import { RoleBadge } from "@/components/role-badge";
import { WeekDots } from "@/components/week-dots";
import { PhasePills } from "@/components/phase-pills";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ActionResultLine,
  DangerButton,
  useRosterAction,
  useSelection,
} from "@/components/roster-actions";
import { deleteCharacters, setCharactersStatus } from "@/app/roster/actions";
import { attendanceTitle } from "@/lib/analysis/performance";
import { ROLES, WOW_CLASSES, type CharacterStatus } from "@/lib/constants/wow";
import type { AttendanceSummary, Phase, Role, WowClass } from "@/lib/types";

export interface RosterRow {
  id: string;
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
  /** From imported Warcraft Logs reports; undefined until one exists. */
  attendance?: AttendanceSummary;
  /** Spec from their most recent logged pulls — flagged when it disagrees. */
  loggedSpec?: string;
}

export function RosterTable({ rows, activePhase }: { rows: RosterRow[]; activePhase: Phase }) {
  const [classFilter, setClassFilter] = React.useState<string>("all");
  const [roleFilter, setRoleFilter] = React.useState<string>("all");
  const { selected, toggle, setAll, clear } = useSelection();
  const { pending, result, run } = useRosterAction(clear);

  const filtered = React.useMemo(
    () =>
      rows.filter(
        (r) =>
          (classFilter === "all" || r.wowClass === classFilter) &&
          (roleFilter === "all" || r.role === roleFilter),
      ),
    [rows, classFilter, roleFilter],
  );
  const filteredIds = React.useMemo(() => filtered.map((r) => r.id), [filtered]);
  const selectedIds = [...selected];

  const columns = React.useMemo<ColumnDef<RosterRow, unknown>[]>(
    () => [
      {
        id: "select",
        enableSorting: false,
        header: () => (
          <Checkbox
            checked={filteredIds.length > 0 && filteredIds.every((id) => selected.has(id))}
            onChange={(e) => setAll(filteredIds, e.target.checked)}
            aria-label="Select all visible characters"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={selected.has(row.original.id)}
            onChange={(e) => toggle(row.original.id, e.target.checked)}
            aria-label={`Select ${row.original.name}`}
          />
        ),
      },
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
        cell: ({ row }) => {
          const { wowClass, spec, loggedSpec } = row.original;
          const mismatch =
            loggedSpec !== undefined &&
            loggedSpec.replace(/\s/g, "").toLowerCase() !== spec.replace(/\s/g, "").toLowerCase();
          return (
            <span className="flex items-center gap-1.5">
              <ClassBadge wowClass={wowClass} spec={spec} />
              {mismatch && (
                <Badge
                  variant="warning"
                  title={`Recent logs show ${loggedSpec}, but the roster entry says ${spec} — worth updating (or they respecced).`}
                >
                  logs: {loggedSpec}
                </Badge>
              )}
            </span>
          );
        },
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
        id: "attendance",
        // Never-seen sorts below 0% so it can't hide between real percentages.
        accessorFn: (row) =>
          row.attendance === undefined || row.attendance.raidsAttended === 0
            ? -1
            : row.attendance.raidPct,
        header: "Attendance",
        cell: ({ row }) => {
          const a = row.original.attendance;
          if (!a) return <span className="text-xs text-muted-foreground/50">—</span>;
          if (a.raidsAttended === 0) {
            return (
              <span
                className="text-xs text-muted-foreground/60"
                title={`Not in any of the ${a.raidsTotal} imported raid log${a.raidsTotal === 1 ? "" : "s"}`}
              >
                never logged
              </span>
            );
          }
          return (
            <span className="flex flex-col gap-0.5" title={attendanceTitle(a)}>
              <WeekDots weeks={a.weeks} />
              <span
                className={`text-xs tabular-nums ${a.raidPct < 50 ? "text-amber-600" : "text-muted-foreground"}`}
              >
                {a.weeksAttended}/{a.weeksTracked} wk · {a.raidPct}%
              </span>
            </span>
          );
        },
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
      {
        id: "perf",
        enableSorting: false,
        header: "",
        cell: ({ row }) => (
          <Button asChild variant="ghost" size="sm" className="h-7 w-7 p-0">
            <Link
              href={`/characters/${encodeURIComponent(row.original.name.toLowerCase())}/performance`}
              title={`${row.original.name}'s performance (Warcraft Logs)`}
            >
              <Activity className="h-3.5 w-3.5" />
            </Link>
          </Button>
        ),
      },
    ],
    [activePhase, selected, filteredIds, toggle, setAll],
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
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5">
          <span className="text-xs tabular-nums text-muted-foreground">{selected.size} selected</span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-xs"
            disabled={pending}
            onClick={() => run(() => setCharactersStatus({ characterIds: selectedIds, status: "pug" }))}
          >
            Move to puggers
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-xs"
            disabled={pending}
            onClick={() => run(() => setCharactersStatus({ characterIds: selectedIds, status: "inactive" }))}
          >
            Set inactive
          </Button>
          <DangerButton
            disabled={pending}
            confirmLabel={`Delete ${selected.size} — confirm`}
            onConfirm={() => run(() => deleteCharacters({ characterIds: selectedIds }))}
          >
            Delete
          </DangerButton>
          <span className="text-[11px] text-muted-foreground">
            Deleting unlinks history: awards reopen under the raw name, log pulls go back to untracked.
          </span>
        </div>
      )}
      <ActionResultLine result={result} />
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
