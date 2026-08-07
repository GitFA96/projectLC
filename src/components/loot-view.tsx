"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { format, parseISO } from "date-fns";
import { CircleAlert, CircleCheck, Loader2, Pencil, Plus } from "lucide-react";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { ItemLink, type ItemRef } from "@/components/item-link";
import { CharacterLink } from "@/components/class-badge";
import { ResolveAwardControl } from "@/components/resolve-award";
import {
  DangerButton,
  RowCheckbox,
  SelectAllCheckbox,
  SelectionProvider,
  useSelection,
} from "@/components/roster-actions";
import { LootAwardDialog, type AwardDialogTarget } from "@/components/loot-award-dialog";
import { deleteAwardsAction, deleteSessionAction, type LootActionResult } from "@/app/loot/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

/** Module constant: an inline literal here would defeat DataTable's memo. */
const LOOT_SORT: SortingState = [{ id: "date", desc: true }];

export interface LootRow {
  id: string;
  awardedAt: string;
  sessionId: string;
  sessionLabel: string;
  phase?: Phase;
  item: ItemRef;
  winnerName: string;
  winnerClass?: WowClass;
  /** The linked roster character, when winnerStatus === "roster" (prefills the editor). */
  winnerCharacterId?: string;
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

  // Editing: row selection for bulk delete, the add/edit dialog, and a shared
  // pending/result line for the session-level and bulk actions.
  const selection = useSelection();
  const { selected, clear } = selection;
  const [dialog, setDialog] = React.useState<AwardDialogTarget | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [actionResult, setActionResult] = React.useState<LootActionResult | null>(null);

  const runAction = (fn: () => Promise<LootActionResult>, onOk?: () => void) => {
    setActionResult(null);
    startTransition(async () => {
      const res = await fn();
      setActionResult(res);
      if (res.ok) {
        clear();
        onOk?.();
      }
    });
  };

  const editTarget = (r: LootRow): AwardDialogTarget => ({
    mode: "edit",
    raidSessionId: r.sessionId,
    sessionLabel: r.sessionLabel,
    award: {
      id: r.id,
      itemId: r.item.itemId,
      itemName: r.item.name ?? `Item #${r.item.itemId}`,
      winnerName: r.winnerName,
      winnerCharacterId: r.winnerCharacterId,
      external: r.winnerStatus === "external",
      offspec: r.offspec,
      note: r.note,
    },
  });

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

  const filteredIds = React.useMemo(() => filtered.map((r) => r.id), [filtered]);

  const columns = React.useMemo<ColumnDef<LootRow, unknown>[]>(
    () => [
      {
        id: "select",
        enableSorting: false,
        header: () => <SelectAllCheckbox label="Select all shown awards" />,
        cell: ({ row }) => <RowCheckbox id={row.original.id} label="Select award" />,
      },
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
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => setDialog(editTarget(row.original))}
          >
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
        ),
      },
    ],
    [characters],
  );

  const activeSession = sessionFilter === "all" ? undefined : sessions.find((s) => s.id === sessionFilter);

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

        {activeSession && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-2">
            <span className="text-sm font-medium">{activeSession.label}</span>
            <span className="text-xs text-muted-foreground">
              {format(parseISO(activeSession.date), "d MMM yyyy")} · {activeSession.count} award
              {activeSession.count === 1 ? "" : "s"}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2.5 text-xs"
                disabled={pending}
                onClick={() =>
                  setDialog({ mode: "add", raidSessionId: activeSession.id, sessionLabel: activeSession.label })
                }
              >
                <Plus className="h-3.5 w-3.5" /> Add award
              </Button>
              <DangerButton
                disabled={pending}
                confirmLabel="Delete import — confirm"
                onConfirm={() =>
                  runAction(() => deleteSessionAction({ sessionId: activeSession.id }), () => setSessionFilter("all"))
                }
              >
                Delete import
              </DangerButton>
            </div>
          </div>
        )}

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5">
            <span className="text-xs tabular-nums text-muted-foreground">
              {selected.size} selected
              {pending && <Loader2 className="ml-1.5 inline h-3 w-3 animate-spin" />}
            </span>
            <DangerButton
              disabled={pending}
              confirmLabel={`Delete ${selected.size} — confirm`}
              onConfirm={() => runAction(() => deleteAwardsAction({ awardIds: [...selected] }))}
            >
              Delete selected
            </DangerButton>
            <Button variant="ghost" size="sm" className="h-7 px-2.5 text-xs" disabled={pending} onClick={clear}>
              Clear
            </Button>
          </div>
        )}

        {actionResult && (
          <p
            className={cn(
              "flex items-start gap-1.5 text-xs",
              actionResult.ok ? "text-success-ink" : "text-warn-ink",
            )}
          >
            {actionResult.ok ? (
              <CircleCheck className="mt-px h-3.5 w-3.5 shrink-0" />
            ) : (
              <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
            )}
            {actionResult.message}
          </p>
        )}

        <div className="rounded-xl border bg-card">
          {/*
            Half the default page size: a ledger row carries a checkbox, an edit
            button and an item link, so it costs several times what an item-list
            row does to hydrate. Fifty of these is about the same work as a
            hundred of those.

            The provider is what lets the checkboxes read the selection without
            `columns` depending on it — see SelectionProvider. Every prop below
            is stable across a tick, so the memoized table skips the re-render
            entirely and only the ticked checkbox updates.
          */}
          <SelectionProvider selection={selection} scopeIds={filteredIds}>
            <DataTable
              columns={columns}
              data={filtered}
              initialSorting={LOOT_SORT}
              emptyMessage="No awards match the filters."
              pageSize={50}
            />
          </SelectionProvider>
        </div>
      </div>

      {dialog && (
        <LootAwardDialog
          target={dialog}
          roster={characters}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
