"use client";

import * as React from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { deleteGearSet } from "@/app/characters/actions";
import type { Phase } from "@/lib/types";

export interface GearSetRow {
  id: string;
  name: string;
  kind: "current" | "wishlist";
  phase?: Phase;
  importedAt: string;
  slotCount: number;
  source: string;
}

function kindLabel(set: GearSetRow): string {
  return set.kind === "current" ? "Current gear" : `P${set.phase} wishlist`;
}

function SetRow({ set, characterName }: { set: GearSetRow; characterName: string }) {
  const [confirming, setConfirming] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const updateHref = `/admin/import?character=${encodeURIComponent(characterName)}&kind=${set.kind}${
    set.phase ? `&phase=${set.phase}` : ""
  }`;

  const remove = () => {
    startTransition(async () => {
      const result = await deleteGearSet(set.id);
      if (!result.ok) {
        setError(result.message);
        setConfirming(false);
      }
      // On success the action revalidates and this row re-renders away.
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
      <Badge variant={set.kind === "current" ? "secondary" : "muted"}>{kindLabel(set)}</Badge>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{set.name}</span>
      <span className="text-xs tabular-nums text-muted-foreground">
        {set.slotCount} slots · imported {format(parseISO(set.importedAt), "d MMM yyyy")} · {set.source}
      </span>
      <span className="flex items-center gap-1">
        <Button asChild variant="ghost" size="sm" title="Re-import to update this set">
          <Link href={updateHref}>
            <RefreshCw className="h-3.5 w-3.5" /> Update
          </Link>
        </Button>
        {confirming ? (
          <>
            <Button variant="destructive" size="sm" onClick={remove} disabled={pending}>
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Confirm delete"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={pending}>
              Keep
            </Button>
          </>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-danger-ink"
            onClick={() => setConfirming(true)}
            title="Delete this set"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </span>
      {error && <p className="w-full text-xs text-danger-ink">{error}</p>}
    </div>
  );
}

/**
 * The character's imported sets with update (re-import, prefilled) and delete.
 * Deleting a wishlist removes its tracking; loot awards are never touched.
 */
export function GearSetManager({
  sets,
  characterName,
}: {
  sets: GearSetRow[];
  characterName: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Imported sets</CardTitle>
        <p className="text-xs text-muted-foreground">
          “Update” jumps to the import page prefilled for that set — pasting a newer SixtyUpgrades
          export shows what changed before replacing. Deleting a set never touches loot history.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {sets.length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing imported for {characterName} yet.</p>
        )}
        {sets.map((set) => (
          <SetRow key={set.id} set={set} characterName={characterName} />
        ))}
        <Button asChild variant="outline" size="sm">
          <Link href={`/admin/import?character=${encodeURIComponent(characterName)}`}>
            Import another set
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
