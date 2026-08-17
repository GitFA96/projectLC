"use client";

import * as React from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { Activity, Wand2 } from "lucide-react";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { CharacterLink, ClassBadge } from "@/components/class-badge";
import { RoleBadge } from "@/components/role-badge";
import { WeekDots } from "@/components/week-dots";
import { PhasePills } from "@/components/phase-pills";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  RowCheckbox,
  SelectAllCheckbox,
  SelectionProvider,
  useSelection,
} from "@/components/roster-actions";
import { deleteCharacters, equipRosterFromLogs, setCharactersStatus } from "@/app/roster/actions";
import { AttendanceDetail } from "@/components/performance/attendance-detail";
import { sameSpec } from "@/lib/utils";
import { ROLES, WOW_CLASSES, type CharacterStatus } from "@/lib/constants/wow";
import type { AttendanceSummary, Phase, Role, WowClass } from "@/lib/types";

export interface RosterRow {
  id: string;
  name: string;
  wowClass: WowClass;
  spec: string;
  /** A second spec they actually raid in, when an officer recorded one. */
  offSpec?: string;
  offSpecRole?: Role;
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
  /** Resolved main name when this row is an alt. */
  mainCharacterName?: string;
}

/** Membership filter → which roster statuses it shows. */
function matchesMembership(filter: string, status: CharacterStatus): boolean {
  switch (filter) {
    case "main":
      return status === "main";
    case "roster":
      return status === "main" || status === "trial" || status === "alt";
    case "trial":
      return status === "trial";
    case "alt":
      return status === "alt";
    case "inactive":
      return status === "inactive";
    default:
      return true; // "all"
  }
}

/** Module constant: an inline literal here would defeat DataTable's memo. */
const ROSTER_SORT: SortingState = [{ id: "name", desc: false }];

export function RosterTable({ rows, activePhase }: { rows: RosterRow[]; activePhase: Phase }) {
  // Default to mains — the raiding core — and let alts/inactive be opted in.
  const [membershipFilter, setMembershipFilter] = React.useState<string>("main");
  const [classFilter, setClassFilter] = React.useState<string>("all");
  const [roleFilter, setRoleFilter] = React.useState<string>("all");
  const selection = useSelection();
  const { selected, clear } = selection;
  const { pending, result, run } = useRosterAction(clear);

  const filtered = React.useMemo(
    () =>
      rows.filter(
        (r) =>
          matchesMembership(membershipFilter, r.status) &&
          (classFilter === "all" || r.wowClass === classFilter) &&
          (roleFilter === "all" || r.role === roleFilter),
      ),
    [rows, membershipFilter, classFilter, roleFilter],
  );
  const filteredIds = React.useMemo(() => filtered.map((r) => r.id), [filtered]);
  const selectedIds = [...selected];

  const columns = React.useMemo<ColumnDef<RosterRow, unknown>[]>(
    () => [
      {
        id: "select",
        enableSorting: false,
        header: () => <SelectAllCheckbox label="Select all visible characters" />,
        cell: ({ row }) => (
          <RowCheckbox id={row.original.id} label={`Select ${row.original.name}`} />
        ),
      },
      {
        id: "name",
        accessorKey: "name",
        header: "Character",
        cell: ({ row }) => (
          <span className="flex items-center gap-1.5">
            <CharacterLink name={row.original.name} wowClass={row.original.wowClass} />
            {row.original.status === "alt" && (
              <Badge
                variant="muted"
                title={
                  row.original.mainCharacterName
                    ? `Alt of ${row.original.mainCharacterName}`
                    : "Marked as an alt, but no main is set"
                }
              >
                {row.original.mainCharacterName ? `alt of ${row.original.mainCharacterName}` : "alt"}
              </Badge>
            )}
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
          const { wowClass, spec, offSpec, offSpecRole, loggedSpec } = row.original;
          // An off-spec night is expected once it's recorded — only a spec the
          // roster knows nothing about is worth a warning.
          const mismatch =
            loggedSpec !== undefined &&
            !sameSpec(loggedSpec, spec) &&
            !sameSpec(loggedSpec, offSpec);
          return (
            <span className="flex items-center gap-1.5">
              <ClassBadge wowClass={wowClass} spec={spec} />
              {offSpec && (
                <Badge
                  variant="muted"
                  title={`Also raids as ${offSpec}${offSpecRole ? ` (${offSpecRole})` : ""}`}
                >
                  OS: {offSpec}
                </Badge>
              )}
              {mismatch && (
                <Badge
                  variant="warning"
                  title={`Recent logs show ${loggedSpec}, which is neither their main spec (${spec}) nor a recorded off-spec — worth updating, or record it as their off-spec.`}
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
          row.attendance === undefined ||
          row.attendance.raidsAttended === 0 ||
          row.attendance.scorePct === undefined
            ? -1
            : row.attendance.scorePct,
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
            <AttendanceDetail attendance={a}>
              <span className="flex flex-col gap-0.5">
                <WeekDots weeks={a.weeks} />
                <span
                  className={`text-xs tabular-nums ${a.scorePct !== undefined && a.scorePct < 50 ? "text-warn-ink" : "text-muted-foreground"}`}
                >
                  {a.scoreAttended}/{a.scoreTracked} {a.scoreBasis === "week" ? "weeks" : "raids"}
                  {a.scorePct !== undefined && ` · ${a.scorePct}%`}
                </span>
              </span>
            </AttendanceDetail>
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
    [activePhase],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={membershipFilter} onValueChange={setMembershipFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Membership" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="main">Mains</SelectItem>
            <SelectItem value="roster">Mains + trials + alts</SelectItem>
            <SelectItem value="trial">Trials</SelectItem>
            <SelectItem value="alt">Alts only</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="all">All roster</SelectItem>
          </SelectContent>
        </Select>
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
            className="h-7 gap-1 px-2.5 text-xs"
            disabled={pending}
            onClick={() => run(() => equipRosterFromLogs({ characterIds: selectedIds }))}
            title="Fill each raider's empty gear slots from what they were last logged wearing"
          >
            <Wand2 className="h-3.5 w-3.5" /> Gear from logs
          </Button>
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
        <SelectionProvider selection={selection} scopeIds={filteredIds}>
          <DataTable
            columns={columns}
            data={filtered}
            resetPageOn={[membershipFilter, classFilter, roleFilter].join("|")}
            initialSorting={ROSTER_SORT}
            emptyMessage="No characters match the filters."
          />
        </SelectionProvider>
      </div>
    </div>
  );
}
