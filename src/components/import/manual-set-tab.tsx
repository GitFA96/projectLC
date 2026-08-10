"use client";

import * as React from "react";
import { Loader2, Plus, X } from "lucide-react";
import { commitManualGearSet } from "@/app/admin/import/actions";
import type { SixtyCommitResult } from "@/app/admin/import/actions";
import { GEAR_SET_KINDS, PHASES, SLOT_IDS, SLOT_LABELS, type SlotId } from "@/lib/constants/wow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * A gear set typed by hand, for when nobody has exported one.
 *
 * The loot rules read a raider's lists from **every** phase, not just the
 * active one — so a phase with no list imported is a hole in what the council
 * can see, and until now the only way to fill it was to go and build the set on
 * SixtyUpgrades first. That also made the rules hard to test: checking that a
 * P4 list behaves needed a real P4 export.
 *
 * **Start from** is the reason this is usable at all. Copying an existing list
 * into another phase and changing the four slots that differ beats typing
 * seventeen item ids, and it's what an officer actually does when a tier lands.
 */
export interface ExistingSet {
  characterName: string;
  kind: (typeof GEAR_SET_KINDS)[number];
  phase?: number;
  name: string;
  source: string;
  slots: { slot: SlotId; itemId: number; itemName: string }[];
}

interface Row {
  key: string;
  slot: SlotId;
  itemId: string;
  itemName: string;
}

let nextKey = 0;
const newRow = (slot: SlotId, itemId = "", itemName = ""): Row => ({
  key: `r${nextKey++}`,
  slot,
  itemId,
  itemName,
});

/** The first slot nothing has claimed yet, so adding a row rarely needs a fix. */
function firstFreeSlot(rows: Row[]): SlotId {
  const used = new Set(rows.map((r) => r.slot));
  return SLOT_IDS.find((s) => !used.has(s)) ?? "head";
}

export function ManualSetTab({
  characters,
  existingSets,
}: {
  characters: string[];
  existingSets: ExistingSet[];
}) {
  const [characterName, setCharacterName] = React.useState(characters[0] ?? "");
  const [kind, setKind] = React.useState<(typeof GEAR_SET_KINDS)[number]>("wishlist");
  const [phase, setPhase] = React.useState<number>(PHASES[0]?.phase ?? 1);
  const [name, setName] = React.useState("");
  const [rows, setRows] = React.useState<Row[]>([newRow("head")]);
  const [result, setResult] = React.useState<SixtyCommitResult | null>(null);
  const [pending, startTransition] = React.useTransition();

  const theirs = existingSets.filter((s) => s.characterName === characterName);

  const startFrom = (set: ExistingSet) => {
    setRows(
      set.slots.map((s) => newRow(s.slot, String(s.itemId), s.itemName)),
    );
    setResult(null);
  };

  const submit = (confirmReplace: boolean) => {
    setResult(null);
    const slots = rows
      .filter((r) => r.itemId.trim() !== "")
      .map((r) => ({
        slot: r.slot,
        itemId: Number(r.itemId.trim()),
        itemName: r.itemName.trim() || undefined,
      }));
    if (slots.some((s) => !Number.isInteger(s.itemId) || s.itemId <= 0)) {
      setResult({ status: "error", message: "Every filled row needs a numeric item id." });
      return;
    }
    startTransition(async () => {
      setResult(
        await commitManualGearSet({
          characterName,
          kind,
          phase: kind === "wishlist" ? (phase as 1 | 2 | 3 | 4 | 5) : undefined,
          name: name.trim() || undefined,
          slots,
          confirmReplace,
        }),
      );
    });
  };

  const filled = rows.filter((r) => r.itemId.trim() !== "").length;

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle>Build a set by hand</CardTitle>
        <p className="text-sm text-muted-foreground">
          For a phase nobody has exported yet. The loot rules read every phase&apos;s list, not
          just the active one, so a missing phase is a gap the council can&apos;t see past. Saved
          as a <span className="font-medium text-foreground">manual</span> set, so months from now
          it&apos;s obvious a person typed it rather than a tool exporting it.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm">
            <span className="block text-xs font-medium text-muted-foreground">Character</span>
            <select
              value={characterName}
              onChange={(e) => setCharacterName(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm shadow-xs"
            >
              {characters.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="block text-xs font-medium text-muted-foreground">Kind</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as (typeof GEAR_SET_KINDS)[number])}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm shadow-xs"
            >
              <option value="wishlist">Phase wishlist</option>
              <option value="current">Current gear</option>
            </select>
          </label>
          {kind === "wishlist" && (
            <label className="space-y-1 text-sm">
              <span className="block text-xs font-medium text-muted-foreground">Phase</span>
              <select
                value={phase}
                onChange={(e) => setPhase(Number(e.target.value))}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm shadow-xs"
              >
                {PHASES.map((p) => (
                  <option key={p.phase} value={p.phase}>
                    P{p.phase}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="space-y-1 text-sm">
            <span className="block text-xs font-medium text-muted-foreground">
              Name (optional)
            </span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={kind === "wishlist" ? `P${phase} wishlist` : "Current gear"}
              className="h-9 w-48"
            />
          </label>
        </div>

        {theirs.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-2.5">
            <span className="text-xs font-medium text-muted-foreground">Start from</span>
            {theirs.map((s) => (
              <Button
                key={`${s.kind}-${s.phase ?? "cur"}-${s.name}`}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => startFrom(s)}
                className="h-7"
              >
                {s.kind === "wishlist" ? `P${s.phase}` : "Current"} · {s.slots.length} slots
              </Button>
            ))}
            <span className="text-[11px] text-muted-foreground">
              copies the items in — change the ones that differ
            </span>
          </div>
        )}

        <div className="space-y-1.5">
          {rows.map((row, i) => (
            <div key={row.key} className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Slot"
                value={row.slot}
                onChange={(e) =>
                  setRows((rs) =>
                    rs.map((r, j) => (j === i ? { ...r, slot: e.target.value as SlotId } : r)),
                  )
                }
                className="h-8 w-36 rounded-md border border-input bg-background px-2 text-sm shadow-xs"
              >
                {SLOT_IDS.map((s) => (
                  <option key={s} value={s}>
                    {SLOT_LABELS[s]}
                  </option>
                ))}
              </select>
              <Input
                value={row.itemId}
                onChange={(e) =>
                  setRows((rs) => rs.map((r, j) => (j === i ? { ...r, itemId: e.target.value } : r)))
                }
                placeholder="Item id"
                inputMode="numeric"
                className="h-8 w-28"
              />
              <Input
                value={row.itemName}
                onChange={(e) =>
                  setRows((rs) =>
                    rs.map((r, j) => (j === i ? { ...r, itemName: e.target.value } : r)),
                  )
                }
                placeholder="Name (optional — the cache fills it in)"
                className="h-8 w-72"
              />
              <button
                type="button"
                aria-label="Remove row"
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setRows((rs) => [...rs, newRow(firstFreeSlot(rs))])}
            className="h-8"
          >
            <Plus className="h-3.5 w-3.5" /> Add slot
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => submit(false)} disabled={pending || filled === 0}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save {filled} slot{filled === 1 ? "" : "s"}
          </Button>
          {result?.status === "needs-confirm" && (
            <Button variant="destructive" onClick={() => submit(true)} disabled={pending}>
              Replace the existing set
            </Button>
          )}
        </div>

        {result?.status === "error" && (
          <p className="text-sm text-destructive">{result.message}</p>
        )}
        {result?.status === "needs-confirm" && (
          <p className="rounded-md border border-warn-line bg-warn-soft px-2.5 py-2 text-sm text-warn-ink">
            {characterName} already has <strong>{result.existing.name}</strong> with{" "}
            {result.existing.slotCount} slots. Replacing it discards that list.
          </p>
        )}
        {result?.status === "committed" && (
          <p className="rounded-md border border-success-line bg-success-soft px-2.5 py-2 text-sm text-success-ink">
            {result.replaced ? "Replaced" : "Saved"} — {result.setName} for {result.characterName},{" "}
            {result.slotCount} slot{result.slotCount === 1 ? "" : "s"}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
