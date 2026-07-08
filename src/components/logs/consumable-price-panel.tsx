"use client";

import * as React from "react";
import { ChevronRight, Coins, Download, TriangleAlert, Upload } from "lucide-react";
import type { ConsumablePrice } from "@/lib/types";
import { costPerUse } from "@/lib/wcl/consumable-prices";
import { saveReportConsumablePrices } from "@/app/logs/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  const fileRef = React.useRef<HTMLInputElement>(null);

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

  const save = () => {
    // charges must be a positive integer; gold is any non-negative number.
    const prices: Record<string, ConsumablePrice> = {};
    for (const [name, p] of Object.entries(edits)) {
      prices[name] = { gold: p.gold, charges: Math.max(1, Math.round(p.charges)) };
    }
    startTransition(async () => {
      const res = await saveReportConsumablePrices({ code, prices });
      setMsg(res.message);
    });
  };

  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader className="cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <CardTitle className="flex items-center gap-2">
          <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-90")} />
          <Coins className="h-4 w-4 text-amber-500" />
          Consumable prices — this raid
          {usingDefault && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
              <TriangleAlert className="h-3 w-3" /> using defaults
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
            <p className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
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
            <Button size="sm" onClick={save} disabled={pending}>
              {pending ? "Saving…" : "Save this raid's prices"}
            </Button>
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
    </Card>
  );
}
