"use client";

import * as React from "react";
import { Loader2, Minus, PencilLine, Plus, Undo2 } from "lucide-react";
import type { ConsumableAdjustment } from "@/lib/types";
import { saveReportConsumableAdjustments } from "@/app/logs/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * Hand corrections to what this raid's logs say each raider used.
 *
 * The gold estimate is inference, and inference has edges: a flask drunk
 * before the pull timer, a potion on the run back, a night somebody's client
 * dropped. This is where an officer says so — and, just as importantly, where
 * anyone can see that they did. Every entry stays listed with who, what, how
 * many and why, and removing it restores the logged number exactly, because
 * the log itself is never edited.
 */

/** "+2" / "−1" — the sign is the whole point, so it's never dropped. */
function signed(delta: number): string {
  return delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`;
}

export function ConsumableAdjustmentsPanel({
  code,
  adjustments,
  raiders,
  consumables,
  /** Signed gold these adjustments moved, for the "what did this change" line. */
  goldDelta,
}: {
  code: string;
  adjustments: ConsumableAdjustment[];
  /** Raiders in this raid, for the picker. */
  raiders: string[];
  /** Consumable names already priced this raid — the suggestion list. */
  consumables: string[];
  goldDelta: number;
}) {
  const [rows, setRows] = React.useState<ConsumableAdjustment[]>(adjustments);
  const [actorName, setActorName] = React.useState(raiders[0] ?? "");
  const [name, setName] = React.useState("");
  const [delta, setDelta] = React.useState("1");
  const [note, setNote] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const [msg, setMsg] = React.useState<string | null>(null);

  const save = (next: ConsumableAdjustment[], onDone?: () => void) => {
    setMsg(null);
    startTransition(async () => {
      const result = await saveReportConsumableAdjustments({ code, adjustments: next });
      setMsg(result.message);
      if (result.ok) {
        setRows(next);
        onDone?.();
      }
    });
  };

  const add = (direction: 1 | -1) => {
    const count = Math.abs(Number(delta));
    if (!actorName.trim() || !name.trim() || !Number.isInteger(count) || count < 1) {
      setMsg("Pick a raider, name the consumable, and give a whole number of uses.");
      return;
    }
    const entry: ConsumableAdjustment = {
      actorName: actorName.trim(),
      name: name.trim(),
      delta: count * direction,
      note: note.trim() || undefined,
      at: new Date().toISOString(),
    };
    save([...rows, entry], () => {
      setName("");
      setDelta("1");
      setNote("");
    });
  };

  const remove = (index: number) => save(rows.filter((_, i) => i !== index));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <PencilLine className="h-4 w-4 text-muted-foreground" />
          Manual adjustments
          {rows.length > 0 && (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium",
                goldDelta >= 0 ? "bg-warn-fill text-warn-ink" : "bg-success-fill text-success-ink",
              )}
            >
              {rows.length} entr{rows.length === 1 ? "y" : "ies"} ·{" "}
              {goldDelta >= 0 ? "+" : "−"}
              {Math.abs(Math.round(goldDelta)).toLocaleString("en-US")}g
            </span>
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          The log can&apos;t see a flask drunk before the pull timer, a potion on the run back, or
          anything at all on a night someone&apos;s client dropped. Add or remove uses here and the
          raider&apos;s total, this raid&apos;s combined total and their gold-per-raid all follow.
          Nothing is overwritten — removing an entry restores exactly what the log said.
        </p>
        <p className="text-xs text-muted-foreground">
          For a consumable already on a raider&apos;s line, the ± beside it in the table above is the
          same edit with fewer fields. This form is what you need to{" "}
          <strong className="font-medium">add one the log never saw</strong> — there is no badge up
          there to press — and to leave a note saying why.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_5rem]">
          <div>
            <Label htmlFor="adj-raider" className="text-xs">
              Raider
            </Label>
            <Input
              id="adj-raider"
              list={`adj-raiders-${code}`}
              value={actorName}
              onChange={(e) => setActorName(e.target.value)}
              placeholder="Raider"
              className="mt-1 h-8"
            />
            <datalist id={`adj-raiders-${code}`}>
              {raiders.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </div>
          <div>
            <Label htmlFor="adj-item" className="text-xs">
              Consumable
            </Label>
            <Input
              id="adj-item"
              list={`adj-items-${code}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Flask of Relentless Assault"
              className="mt-1 h-8"
            />
            <datalist id={`adj-items-${code}`}>
              {consumables.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div>
            <Label htmlFor="adj-count" className="text-xs">
              Uses
            </Label>
            <Input
              id="adj-count"
              value={delta}
              onChange={(e) => setDelta(e.target.value.replace(/[^\d]/g, ""))}
              inputMode="numeric"
              className="mt-1 h-8 tabular-nums"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[12rem] flex-1">
            <Label htmlFor="adj-note" className="text-xs">
              Why (optional)
            </Label>
            <Input
              id="adj-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="flasked before the log started"
              className="mt-1 h-8"
            />
          </div>
          <Button size="sm" className="h-8 gap-1" disabled={pending} onClick={() => add(1)}>
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Add
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1"
            disabled={pending}
            onClick={() => add(-1)}
          >
            <Minus className="h-3.5 w-3.5" />
            Remove
          </Button>
        </div>
        {msg && <p className="text-xs text-muted-foreground">{msg}</p>}

        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nothing adjusted — this raid&apos;s gold is exactly what the log implied.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Raider</TableHead>
                <TableHead>Consumable</TableHead>
                <TableHead className="w-16 text-right">Uses</TableHead>
                <TableHead>Why</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => (
                <TableRow key={`${row.actorName}-${row.name}-${row.at}-${i}`}>
                  <TableCell className="text-sm">{row.actorName}</TableCell>
                  <TableCell className="text-sm">{row.name}</TableCell>
                  <TableCell
                    className={cn(
                      "text-right text-sm font-medium tabular-nums",
                      row.delta > 0 ? "text-warn-ink" : "text-success-ink",
                    )}
                  >
                    {signed(row.delta)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.note ?? <span className="opacity-50">—</span>}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      disabled={pending}
                      title="Undo this adjustment — the logged count comes back"
                      onClick={() => remove(i)}
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
