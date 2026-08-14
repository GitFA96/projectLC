"use client";

import * as React from "react";
import { ChevronRight, Coins, Download, TriangleAlert, Upload } from "lucide-react";
import type { ConsumablePrice } from "@/lib/types";
import { costPerUse } from "@/lib/wcl/consumable-prices";
import { saveReportConsumablePrices } from "@/app/logs/actions";
import { useUnsavedGuard } from "@/components/use-unsaved-guard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface PriceRow {
  name: string;
  price: ConsumablePrice;
}

/** g/1000 → "1,234g", fractional cost-per-use → "0.30g". */
function gold(n: number): string {
  return n >= 10 ? `${Math.round(n).toLocaleString("en-US")}g` : `${n.toFixed(2)}g`;
}

/** What `save` writes, so an edit can be compared against what's stored. */
function normalize(p: ConsumablePrice): ConsumablePrice {
  return { gold: p.gold, charges: Math.max(1, Math.round(p.charges)) };
}

/**
 * Side panel to log THIS raid's consumable prices (per item + charges) so the
 * gold-spent ranking reflects the week's economy. Until a raid saves its own,
 * the gold view uses code defaults — flagged here and on the ranking.
 */
export function ConsumablePricePanel({
  code,
  rows,
  usingDefault,
}: {
  code: string;
  rows: PriceRow[];
  usingDefault: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [edits, setEdits] = React.useState<Record<string, ConsumablePrice>>(() =>
    Object.fromEntries(rows.map((r) => [r.name, r.price])),
  );
  const [pending, startTransition] = React.useTransition();
  const [msg, setMsg] = React.useState<string | null>(null);
  const [leavingTo, setLeavingTo] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  // Derived rather than a flag, because an edit typed back to its saved value
  // isn't a change — and an import that matched everything isn't one either.
  // Compared through `normalize`, or a charges box left at 0 would read as
  // dirty forever against the 1 that was actually written.
  const changed = rows.filter(({ name, price }) => {
    const edit = edits[name];
    if (!edit) return false;
    const mine = normalize(edit);
    return mine.gold !== price.gold || mine.charges !== price.charges;
  });
  const dirty = changed.length > 0;

  // Unsaved prices are as losable as unsaved corrections, and this panel starts
  // collapsed — so an intercepted click has to open it before it explains
  // itself, or the dialog names edits the officer can't see.
  const onIntercept = React.useCallback((href: string) => {
    setOpen(true);
    setLeavingTo(href);
  }, []);
  const { leave } = useUnsavedGuard({ when: dirty, onIntercept });

  const setField = (name: string, field: keyof ConsumablePrice, raw: string) => {
    const n = Number(raw);
    setEdits((e) => ({
      ...e,
      [name]: { ...e[name], [field]: Number.isFinite(n) && n >= 0 ? n : 0 },
    }));
    setMsg(null);
  };

  // Export the current prices as JSON so the next raid can reuse them.
  const exportPrices = () => {
    const blob = new Blob([JSON.stringify(edits, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `consumable-prices-${code}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg("Exported this raid's prices.");
  };

  // Import a prices file, applying values only for consumables present this raid.
  const importPrices = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be re-picked later
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      if (parsed === null || typeof parsed !== "object") throw new Error("shape");
      const merged = { ...edits };
      let applied = 0;
      for (const [name, val] of Object.entries(parsed as Record<string, unknown>)) {
        if (!(name in merged) || val === null || typeof val !== "object") continue;
        const { gold, charges } = val as Record<string, unknown>;
        if (typeof gold !== "number" || !Number.isFinite(gold) || gold < 0) continue;
        const c = typeof charges === "number" && Number.isFinite(charges) && charges >= 1 ? Math.round(charges) : 1;
        merged[name] = { gold, charges: c };
        applied++;
      }
      setEdits(merged);
      setMsg(
        applied > 0
          ? `Imported ${applied} price${applied === 1 ? "" : "s"} — review and save.`
          : "No consumables in that file matched this raid.",
      );
    } catch {
      setMsg("Couldn't read that file — expected exported prices JSON.");
    }
  };

  const save = (then?: () => void) => {
    // charges must be a positive integer; gold is any non-negative number.
    const prices: Record<string, ConsumablePrice> = {};
    for (const [name, p] of Object.entries(edits)) prices[name] = normalize(p);
    startTransition(async () => {
      const res = await saveReportConsumablePrices({ code, prices });
      setMsg(res.message);
      if (!res.ok) return;
      // Hold exactly what was written, so `dirty` settles the moment the
      // refreshed prices arrive instead of catching on a rounded charge.
      setEdits(prices);
      then?.();
    });
  };

  const discard = () => {
    setEdits(Object.fromEntries(rows.map((r) => [r.name, r.price])));
    setMsg(null);
  };

  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader className="cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <CardTitle className="flex items-center gap-2">
          <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-90")} />
          <Coins className="h-4 w-4 text-warn" />
          Consumable prices — this raid
          {usingDefault && (
            <span className="inline-flex items-center gap-1 rounded-full bg-warn-fill px-2 py-0.5 text-[11px] font-medium text-warn-ink">
              <TriangleAlert className="h-3 w-3" /> using defaults
            </span>
          )}
          {/* Collapsed, this badge is the only sign the edits are still open —
              and it's what has to cover browser back, which no guard catches. */}
          {dirty && (
            <span className="rounded-full bg-warn-fill px-2 py-0.5 text-[11px] font-medium text-warn-ink">
              {changed.length} unsaved price{changed.length === 1 ? "" : "s"}
            </span>
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Prices per item and charges per item (Drums carry ~50) — cost per use = price ÷ charges.
          Logged per raid so the gold view tracks inflation. {open ? "" : "Click to edit."}
        </p>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3">
          {usingDefault && (
            <p className="flex items-start gap-1.5 rounded-md border border-warn-line bg-warn-soft p-2 text-xs text-warn-ink">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              This raid is using default prices — they may not match the week&apos;s economy. Adjust
              and save to log accurate values for this night.
            </p>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Consumable</TableHead>
                <TableHead className="w-28 text-right">Price / item</TableHead>
                <TableHead className="w-24 text-right">Charges</TableHead>
                <TableHead className="w-24 text-right">Cost / use</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ name }) => {
                const p = edits[name];
                return (
                  <TableRow key={name}>
                    <TableCell className="text-sm font-medium">{name}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        min={0}
                        step="0.5"
                        value={p.gold}
                        onChange={(e) => setField(name, "gold", e.target.value)}
                        className="h-8 text-right tabular-nums"
                        aria-label={`${name} price per item in gold`}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        min={1}
                        step="1"
                        value={p.charges}
                        onChange={(e) => setField(name, "charges", e.target.value)}
                        className="h-8 text-right tabular-nums"
                        aria-label={`${name} charges per item`}
                      />
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                      {gold(costPerUse(p))}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => save()} disabled={pending}>
              {pending ? "Saving…" : "Save this raid's prices"}
            </Button>
            {dirty && (
              <Button size="sm" variant="ghost" onClick={discard} disabled={pending}>
                Discard
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={exportPrices}>
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload className="h-3.5 w-3.5" /> Import
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={importPrices}
            />
            {msg && <span className="ml-1 text-xs text-muted-foreground">{msg}</span>}
          </div>
        </CardContent>
      )}

      <Modal
        open={leavingTo !== null}
        onClose={() => setLeavingTo(null)}
        title={`${changed.length} unsaved price${changed.length === 1 ? "" : "s"}`}
        description="Leaving this page now throws them away — nothing has been written yet."
      >
        <p className="mb-3 text-xs text-muted-foreground">
          {changed.map((r) => r.name).join(", ")}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setLeavingTo(null)} disabled={pending}>
            Stay here
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const to = leavingTo;
              discard();
              setLeavingTo(null);
              if (to) leave(to);
            }}
            disabled={pending}
          >
            Discard and leave
          </Button>
          <Button
            size="sm"
            onClick={() => {
              const to = leavingTo;
              save(() => {
                setLeavingTo(null);
                if (to) leave(to);
              });
            }}
            disabled={pending}
          >
            {pending ? "Saving…" : "Save and leave"}
          </Button>
        </div>
      </Modal>
    </Card>
  );
}
