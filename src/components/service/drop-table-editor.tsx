"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  addFoundationalDropAction,
  removeFoundationalDropAction,
  seedFoundationalDropsAction,
} from "@/app/service/drops/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ItemIcon } from "@/components/item-icon";
import { compareText } from "@/lib/sort";
import { QUALITY_TEXT_COLORS, wowheadItemUrl } from "@/lib/constants/wow";
import type { MergedDrop } from "@/lib/loot/drop-table";

/**
 * The foundational drop table, boss by boss.
 *
 * Two things an operator does here and nothing else: import what this
 * deployment already knows, and correct it. Correcting is the point — the
 * reason this table exists is that "Hammer of Judgment" was a one-letter
 * mistake in a seed file, and fixing it meant shipping a release.
 *
 * A drop with no item id is shown saying so rather than hidden: it is a known
 * drop the cache cannot picture yet, which is a normal state for a table
 * written in names, and an operator watching the count fall is watching the
 * resolver work.
 */
export function DropTableEditor({
  zone,
  bosses,
  drops,
}: {
  zone: string;
  /** Every boss the raid table names, in kill order, trash first. */
  bosses: string[];
  drops: MergedDrop[];
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [notice, setNotice] = React.useState<string | undefined>();
  const [error, setError] = React.useState<string | undefined>();

  const run = (fn: () => Promise<{ ok: boolean; message: string }>) =>
    startTransition(async () => {
      const result = await fn();
      setNotice(result.ok ? result.message : undefined);
      setError(result.ok ? undefined : result.message);
      if (result.ok) router.refresh();
    });

  const byBoss = new Map<string, MergedDrop[]>();
  for (const drop of drops) {
    byBoss.set(drop.bossKey, [...(byBoss.get(drop.bossKey) ?? []), drop]);
  }
  // Anything filed under a boss the raid table does not name still has to be
  // reachable — it is exactly the sort of row an operator came here to fix.
  const known = new Set(bosses.map((b) => keyOf(b)));
  const strays = [...byBoss.keys()].filter((k) => !known.has(k));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="text-base">Import what this deployment knows</CardTitle>
          <p className="text-xs text-muted-foreground">
            Reads the boss headings on every priority sheet, then the drop sources on cached items.
            Only the factual half — the boss, the item name, the slot wording. Priority chains and
            the sheet&apos;s notes column are a council&apos;s judgement and are not copied. Safe to
            press repeatedly: it fills gaps and never overwrites.
          </p>
        </CardHeader>
        <CardContent>
          <Button size="sm" disabled={pending} onClick={() => run(seedFoundationalDropsAction)}>
            <RefreshCw className={pending ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
            Import drop table
          </Button>
          {notice && <p className="mt-2 text-xs text-muted-foreground">{notice}</p>}
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {[...bosses, ...strays].map((boss) => {
        const key = keyOf(boss);
        const rows = (byBoss.get(key) ?? [])
          .slice()
          .sort((a, b) => compareText(a.itemName, b.itemName));
        const label = rows[0]?.boss ?? boss;
        const withoutId = rows.filter((r) => r.itemId === undefined).length;
        return (
          <Card key={key || boss}>
            <CardHeader className="space-y-1">
              <CardTitle className="flex flex-wrap items-baseline gap-2 text-base">
                {label}
                <span className="text-xs font-normal text-muted-foreground">
                  {rows.length === 0
                    ? "nothing listed"
                    : `${rows.length} drop${rows.length === 1 ? "" : "s"}`}
                </span>
                {!known.has(key) && (
                  <Badge variant="warning" className="font-normal">
                    not in the raid table
                  </Badge>
                )}
                {withoutId > 0 && (
                  <Badge variant="muted" className="font-normal">
                    {withoutId} without an id
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {rows.map((row) => (
                <div
                  key={row.itemKey}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b py-1.5 text-sm last:border-b-0"
                >
                  <ItemIcon icon={row.icon} quality={row.quality} size={20} />
                  <span
                    className="min-w-0 flex-1 font-medium"
                    style={row.quality ? { color: QUALITY_TEXT_COLORS[row.quality] } : undefined}
                  >
                    {row.itemName}
                  </span>
                  {/* What somebody typed, when the item disagrees. This is the
                      whole reason an operator opens this page, so it is stated
                      rather than left to be noticed. */}
                  {row.writtenName && (
                    <span
                      className="shrink-0 text-xs text-warn-ink"
                      title={`The table has it as "${row.writtenName}"`}
                    >
                      written &ldquo;{row.writtenName}&rdquo;
                    </span>
                  )}
                  {row.slotLabel && (
                    <span className="text-xs text-muted-foreground">{row.slotLabel}</span>
                  )}
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {row.itemId ?? "no id yet"}
                  </span>
                  {row.itemId !== undefined && (
                    <a
                      href={wowheadItemUrl(row.itemId)}
                      target="_blank"
                      rel="noreferrer noopener"
                      title={`Open ${row.itemName} on Wowhead`}
                      aria-label={`Open ${row.itemName} on Wowhead`}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                  <button
                    type="button"
                    disabled={pending}
                    aria-label={`Remove ${row.itemName}`}
                    onClick={() =>
                      run(() =>
                        removeFoundationalDropAction({
                          zone,
                          boss: row.boss,
                          // The stored spelling, not the resolved one: the key
                          // is the written name, and deleting by the item's
                          // name would miss exactly the rows worth removing.
                          itemName: row.writtenName ?? row.itemName,
                        }),
                      )
                    }
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <AddDrop
                disabled={pending}
                onAdd={(itemName, slotLabel) =>
                  run(() => addFoundationalDropAction({ zone, boss: label, itemName, slotLabel }))
                }
              />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function AddDrop({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (itemName: string, slotLabel?: string) => void;
}) {
  const [itemName, setItemName] = React.useState("");
  const [slotLabel, setSlotLabel] = React.useState("");
  const submit = () => {
    if (!itemName.trim()) return;
    onAdd(itemName.trim(), slotLabel.trim() || undefined);
    setItemName("");
    setSlotLabel("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-1">
      <Input
        value={itemName}
        onChange={(e) => setItemName(e.target.value)}
        placeholder="Item name, exactly as Wowhead spells it"
        className="h-8 max-w-xs"
      />
      <Input
        value={slotLabel}
        onChange={(e) => setSlotLabel(e.target.value)}
        placeholder="Slot (optional)"
        className="h-8 max-w-[10rem]"
      />
      <Button size="sm" variant="outline" disabled={disabled || !itemName.trim()} onClick={submit}>
        {disabled ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Plus className="h-3.5 w-3.5" />
        )}
        Add
      </Button>
    </div>
  );
}

/**
 * Mirrors `bossKey` for grouping rows against the raid table's names.
 *
 * Deliberately a copy rather than an import: this is a client component, and
 * pulling the constants module in for one function drags the raid table, the
 * class list and the colour tables into the browser bundle. The duplication is
 * safe in one direction only — grouping already-keyed rows for display — and it
 * must never become the thing that decides what gets STORED. Writers go through
 * the real `bossKey` on the server; see `upsertBossDrops`.
 */
function keyOf(boss: string): string {
  return boss
    .trim()
    .replace(/^the\s+/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}
