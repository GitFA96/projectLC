"use client";

import * as React from "react";
import { format, parseISO } from "date-fns";
import { CircleAlert, CircleCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CharacterLink, ClassBadge } from "@/components/class-badge";
import { Badge } from "@/components/ui/badge";
import {
  deleteCharacters,
  purgeDemoData,
  setCharactersStatus,
  trackLogPlayers,
  type RosterActionResult,
} from "@/app/roster/actions";
import type { UntrackedLogPlayer, WowClass } from "@/lib/types";

/* Shared selection + action plumbing */

/**
 * Selection, delivered by context instead of by closure.
 *
 * A table's `columns` memo must not depend on which rows are selected. When it
 * does, every tick rebuilds all the column definitions, which hands the table a
 * new set of cell renderers and re-renders every visible row — fifty rows of
 * item links and badges redrawn to put a check in one box.
 *
 * So the checkboxes read the selection themselves. Columns then depend only on
 * things that change their *shape*, the table memoizes cleanly, and a tick
 * re-renders the checkboxes and nothing else.
 */
interface SelectionScope {
  selected: ReadonlySet<string>;
  toggle: (id: string, on: boolean) => void;
  setAll: (ids: string[], on: boolean) => void;
  /** The ids currently in view — what "select all" means at this moment. */
  scopeIds: string[];
}

const SelectionContext = React.createContext<SelectionScope | null>(null);

function useSelectionScope(): SelectionScope {
  const scope = React.useContext(SelectionContext);
  if (!scope) {
    throw new Error("RowCheckbox and SelectAllCheckbox must be inside a <SelectionProvider>.");
  }
  return scope;
}

export function SelectionProvider({
  selection,
  scopeIds,
  children,
}: {
  selection: ReturnType<typeof useSelection>;
  /** Usually the filtered ids: selecting all means all of what's shown. */
  scopeIds: string[];
  children: React.ReactNode;
}) {
  const { selected, toggle, setAll } = selection;
  const value = React.useMemo(
    () => ({ selected, toggle, setAll, scopeIds }),
    [selected, toggle, setAll, scopeIds],
  );
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

/** One row's checkbox. Subscribes on its own, so the row around it need not re-render. */
export function RowCheckbox({ id, label }: { id: string; label: string }) {
  const { selected, toggle } = useSelectionScope();
  return (
    <Checkbox
      aria-label={label}
      checked={selected.has(id)}
      onChange={(e) => toggle(id, e.target.checked)}
    />
  );
}

/** The header checkbox: all of what's currently shown, not all of what exists. */
export function SelectAllCheckbox({ label }: { label: string }) {
  const { selected, setAll, scopeIds } = useSelectionScope();
  return (
    <Checkbox
      aria-label={label}
      checked={scopeIds.length > 0 && scopeIds.every((id) => selected.has(id))}
      onChange={(e) => setAll(scopeIds, e.target.checked)}
    />
  );
}

export function useSelection() {
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
  const toggle = React.useCallback(
    (id: string, on: boolean) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (on) next.add(id);
        else next.delete(id);
        return next;
      }),
    [],
  );
  const setAll = React.useCallback(
    (ids: string[], on: boolean) => setSelected(on ? new Set(ids) : new Set()),
    [],
  );
  const clear = React.useCallback(() => setSelected(new Set()), []);
  return { selected, toggle, setAll, clear };
}

export function useRosterAction(onSuccess?: () => void) {
  const [pending, startTransition] = React.useTransition();
  const [result, setResult] = React.useState<RosterActionResult>();
  const run = (action: () => Promise<RosterActionResult>) => {
    startTransition(async () => {
      const res = await action();
      setResult(res);
      if (res.ok) onSuccess?.();
    });
  };
  return { pending, result, run, clearResult: () => setResult(undefined) };
}

export function ActionResultLine({ result }: { result?: RosterActionResult }) {
  if (!result) return null;
  return (
    <p
      className={`flex items-start gap-1.5 text-xs ${result.ok ? "text-success-ink" : "text-warn-ink"}`}
    >
      {result.ok ? (
        <CircleCheck className="mt-px h-3.5 w-3.5 shrink-0" />
      ) : (
        <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
      )}
      {result.message}
    </p>
  );
}

/** Destructive action with a two-click confirm. */
export function DangerButton({
  onConfirm,
  disabled,
  children,
  confirmLabel,
}: {
  onConfirm: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  confirmLabel: string;
}) {
  const [armed, setArmed] = React.useState(false);
  return (
    <Button
      variant={armed ? "destructive" : "outline"}
      size="sm"
      className="h-7 px-2.5 text-xs"
      disabled={disabled}
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        onConfirm();
      }}
    >
      {armed ? confirmLabel : children}
    </Button>
  );
}

function SelectionBar({
  count,
  pending,
  children,
}: {
  count: number;
  pending: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5">
      <span className="text-xs tabular-nums text-muted-foreground">
        {count} selected{pending && <Loader2 className="ml-1.5 inline h-3 w-3 animate-spin" />}
      </span>
      {children}
    </div>
  );
}

/* Known puggers */

export interface PuggerRow {
  id: string;
  name: string;
  wowClass: WowClass;
  spec: string;
  totalAwards: number;
  lastAwardAt?: string;
}

export function PuggersCard({ rows }: { rows: PuggerRow[] }) {
  const { selected, toggle, setAll, clear } = useSelection();
  const { pending, result, run } = useRosterAction(clear);
  const ids = [...selected];
  const allIds = rows.map((r) => r.id);

  if (rows.length === 0) {
    return (
      <p className="py-2 text-sm text-muted-foreground">
        No known puggers yet — names seen in logs show up below, Gargul winners are resolved in the
        loot ledger.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">
              <Checkbox
                checked={selected.size === rows.length && rows.length > 0}
                onChange={(e) => setAll(allIds, e.target.checked)}
                aria-label="Select all puggers"
              />
            </TableHead>
            <TableHead>Player</TableHead>
            <TableHead>Class &amp; spec</TableHead>
            <TableHead className="text-right">Items won</TableHead>
            <TableHead className="w-32">Last award</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} data-state={selected.has(r.id) ? "selected" : undefined}>
              <TableCell>
                <Checkbox
                  checked={selected.has(r.id)}
                  onChange={(e) => toggle(r.id, e.target.checked)}
                  aria-label={`Select ${r.name}`}
                />
              </TableCell>
              <TableCell>
                <span className="flex items-center gap-1.5">
                  <CharacterLink name={r.name} wowClass={r.wowClass} />
                  <Badge variant="muted">pug</Badge>
                </span>
              </TableCell>
              <TableCell>
                <ClassBadge wowClass={r.wowClass} spec={r.spec} />
              </TableCell>
              <TableCell className="text-right tabular-nums">{r.totalAwards}</TableCell>
              <TableCell className="text-sm tabular-nums text-muted-foreground">
                {r.lastAwardAt ? format(parseISO(r.lastAwardAt), "d MMM yyyy") : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {selected.size > 0 && (
        <SelectionBar count={selected.size} pending={pending}>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-xs"
            disabled={pending}
            onClick={() => run(() => setCharactersStatus({ characterIds: ids, status: "main" }))}
          >
            Move to roster
          </Button>
          <DangerButton
            disabled={pending}
            confirmLabel={`Delete ${selected.size} — confirm`}
            onConfirm={() => run(() => deleteCharacters({ characterIds: ids }))}
          >
            Delete
          </DangerButton>
          <span className="text-[11px] text-muted-foreground">
            Deleting unlinks history: awards reopen under the raw name, log pulls go back to
            untracked.
          </span>
        </SelectionBar>
      )}
      <ActionResultLine result={result} />
    </div>
  );
}

/* Untracked log players */

export interface UntrackedRow extends UntrackedLogPlayer {
  /** Resolved server-side when the log's class string matches a WoW class. */
  knownClass?: WowClass;
}

export function UntrackedCard({ players }: { players: UntrackedRow[] }) {
  const { selected, toggle, setAll, clear } = useSelection();
  const { pending, result, run } = useRosterAction(clear);
  const byName = new Map(players.map((p) => [p.name.toLowerCase(), p]));
  const allIds = players.map((p) => p.name.toLowerCase());

  const track = (status: "pug" | "main") =>
    run(() =>
      trackLogPlayers({
        players: [...selected]
          .map((key) => byName.get(key))
          .filter((p): p is UntrackedRow => p !== undefined)
          .map((p) => ({ name: p.name, className: p.className, spec: p.spec, wclRole: p.role })),
        status,
      }),
    );

  return (
    <div className="space-y-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">
              <Checkbox
                checked={selected.size === players.length && players.length > 0}
                onChange={(e) => setAll(allIds, e.target.checked)}
                aria-label="Select all untracked players"
              />
            </TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Class &amp; spec (from log)</TableHead>
            <TableHead className="text-right">Boss pulls</TableHead>
            <TableHead className="w-32">Last seen</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {players.map((p) => {
            const key = p.name.toLowerCase();
            return (
              <TableRow key={key} data-state={selected.has(key) ? "selected" : undefined}>
                <TableCell>
                  <Checkbox
                    checked={selected.has(key)}
                    onChange={(e) => toggle(key, e.target.checked)}
                    aria-label={`Select ${p.name}`}
                  />
                </TableCell>
                <TableCell className="text-sm font-medium">{p.name}</TableCell>
                <TableCell>
                  {p.knownClass ? (
                    <ClassBadge wowClass={p.knownClass} spec={p.spec ?? "?"} />
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      {[p.className, p.spec].filter(Boolean).join(" · ") || "unknown"}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {p.appearances}
                  <span className="text-xs text-muted-foreground">
                    {" "}
                    in {p.reportCount} report{p.reportCount === 1 ? "" : "s"}
                  </span>
                </TableCell>
                <TableCell className="text-sm tabular-nums text-muted-foreground">
                  {p.lastSeen ? format(parseISO(p.lastSeen), "d MMM yyyy") : "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {selected.size > 0 && (
        <SelectionBar count={selected.size} pending={pending}>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-xs"
            disabled={pending}
            onClick={() => track("pug")}
          >
            Track as puggers
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-xs"
            disabled={pending}
            onClick={() => track("main")}
          >
            Add to roster
          </Button>
        </SelectionBar>
      )}
      <ActionResultLine result={result} />
    </div>
  );
}

/** Two-step destructive button for the demo-data banner. */
export function PurgeDemoButton() {
  const { pending, result, run } = useRosterAction();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <DangerButton
        disabled={pending}
        confirmLabel="Click again to confirm"
        onConfirm={() => run(purgeDemoData)}
      >
        {pending ? "Removing…" : "Remove demo data"}
      </DangerButton>
      {result && !result.ok && <span className="text-xs text-destructive">{result.message}</span>}
    </span>
  );
}
