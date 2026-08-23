"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { EyeOff, Loader2, Plus, Undo2 } from "lucide-react";
import { addDropAction, hideDropAction, restoreDropAction } from "@/app/loot/plan/drop-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { LootPlanHiddenDrop } from "@/lib/analysis/loot-plan";

/**
 * What this guild counts as dropping from a boss, where it differs from the
 * table everybody else reads.
 *
 * These controls live on the loot plan rather than on an admin page because
 * this is where the disagreement is noticed: an officer reading out a boss's
 * drops is exactly the person who knows the trinket has never dropped here, or
 * that the table is missing something the raid saw last week.
 *
 * Nothing here edits the foundational table. Hiding a drop is a statement about
 * this raid, and the operator's row stays as written for every other guild.
 */
export function DropOverrides({
  zone,
  boss,
  hidden,
  canCurate,
}: {
  zone: string;
  boss: string;
  hidden: LootPlanHiddenDrop[];
  canCurate: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [itemName, setItemName] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | undefined>();

  // Nothing hidden and no permission to change anything: render nothing rather
  // than an affordance on every card of a nine-boss raid.
  if (hidden.length === 0 && !canCurate) return null;

  const run = (fn: () => Promise<{ ok: boolean; message: string }>) =>
    startTransition(async () => {
      const result = await fn();
      setError(result.ok ? undefined : result.message);
      if (result.ok) {
        setItemName("");
        setOpen(false);
        router.refresh();
      }
    });

  return (
    <div className="mt-2 space-y-1.5">
      {hidden.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">Not counted here:</span>
          {hidden.map((drop) => (
            <span
              key={drop.itemName}
              className="inline-flex items-center gap-1 rounded-md border border-dashed px-1.5 py-0.5 text-muted-foreground"
            >
              {drop.itemName}
              {canCurate && (
                <button
                  type="button"
                  disabled={pending}
                  aria-label={`Restore ${drop.itemName} to ${boss}`}
                  title="Put it back"
                  onClick={() =>
                    run(() => restoreDropAction({ zone, boss: drop.boss, itemName: drop.itemName }))
                  }
                  className="hover:text-foreground"
                >
                  <Undo2 className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {canCurate &&
        (open ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Input
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              autoFocus
              placeholder={`Item ${boss} drops for us`}
              className="h-8 max-w-xs"
            />
            <Button
              size="sm"
              disabled={pending || !itemName.trim()}
              onClick={() => run(() => addDropAction({ zone, boss, itemName: itemName.trim() }))}
            >
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Add
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setOpen(false);
                setError(undefined);
              }}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            Add a drop we see here
          </button>
        ))}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/**
 * The per-row control: take this drop off this boss, for this guild only.
 *
 * Separate from the panel above because it belongs beside the row it acts on —
 * a hide reached from a list at the bottom of the card would mean re-finding
 * the item you were already looking at.
 */
export function HideDropButton({
  zone,
  boss,
  itemName,
  itemId,
}: {
  zone: string;
  boss: string;
  itemName: string;
  itemId?: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-label={`Stop counting ${itemName} as a ${boss} drop`}
      title="We don't see this drop here"
      onClick={() =>
        startTransition(async () => {
          const result = await hideDropAction({ zone, boss, itemName, itemId });
          if (result.ok) router.refresh();
        })
      }
      className="shrink-0 text-muted-foreground/50 hover:text-warn-ink"
    >
      <EyeOff className="h-3.5 w-3.5" />
    </button>
  );
}
