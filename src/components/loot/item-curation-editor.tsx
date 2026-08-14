"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { reportWrongItemDataAction, setItemCurationAction } from "@/app/items/[itemId]/item-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PHASES } from "@/lib/constants/wow";
import type { Phase } from "@/lib/types";

/**
 * Where an item drops and which tier that makes it — the two things about an
 * item that nothing outside the guild knows.
 *
 * Collapsed to a badge by default, because the header is not a settings panel
 * and most items are already right. It opens because when these are wrong they
 * are wrong quietly: phase moves an item in and out of every phase-scoped
 * view, and zone is the only thing that puts a drop on a raid's loot plan.
 *
 * Zone is free text rather than a menu on purpose. The list the app shipped
 * with names raids, heroics, "Crafted", "Quest" and "Reputation" — an officer
 * recording where something comes from should not be limited to the ones we
 * happened to think of.
 *
 * **All three are filled in by the item resolver**, off the same Wowhead
 * response it already fetches for the name and icon: the phase from the tooltip
 * tag, the boss from the JSON block, and the zone by putting that boss through
 * this app's own raid table. An officer editing them here is overruling
 * Wowhead, and the panel says so — curated values are kept forever and no
 * backfill touches them again.
 *
 * What the resolver cannot answer it leaves blank rather than guessing: a boss
 * outside the raid table (heroics, world drops), or an item several bosses in
 * different raids drop.
 */
export function ItemCurationEditor({
  itemId,
  phase,
  source,
  knownZones,
}: {
  itemId: number;
  phase?: Phase;
  source?: { zone: string; boss?: string };
  /** Zones already in use, offered as suggestions so spelling stays consistent. */
  knownZones: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | undefined>();
  const [notice, setNotice] = React.useState<string | undefined>();

  const [draftPhase, setDraftPhase] = React.useState<Phase | undefined>(phase);
  const [zone, setZone] = React.useState(source?.zone ?? "");
  const [boss, setBoss] = React.useState(source?.boss ?? "");

  // Follow the server once a save lands and the page re-renders. Adjusted
  // during render rather than in an effect: this is state derived from props.
  const [seen, setSeen] = React.useState({ phase, zone: source?.zone, boss: source?.boss });
  if (seen.phase !== phase || seen.zone !== source?.zone || seen.boss !== source?.boss) {
    setSeen({ phase, zone: source?.zone, boss: source?.boss });
    setDraftPhase(phase);
    setZone(source?.zone ?? "");
    setBoss(source?.boss ?? "");
  }

  const save = () => {
    setError(undefined);
    startTransition(async () => {
      const result = await setItemCurationAction(itemId, {
        phase: draftPhase ?? null,
        source: zone.trim() ? { zone: zone.trim(), boss: boss.trim() || undefined } : null,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  };

  /**
   * Ask Wowhead again about this row.
   *
   * Stays open on success, unlike Save: the button reports what will happen on
   * the next backfill rather than changing anything visible here, and closing
   * the panel would read as "done" when nothing has been looked up yet.
   */
  const requeue = () => {
    setError(undefined);
    setNotice(undefined);
    startTransition(async () => {
      const result = await reportWrongItemDataAction(itemId);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setNotice(result.message);
      router.refresh();
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Set where this drops and which phase it belongs to"
        className="rounded-sm underline-offset-2 hover:underline"
      >
        {phase ? (
          <Badge variant="secondary">P{phase}</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">set phase &amp; source</span>
        )}
      </button>
    );
  }

  return (
    <span className="inline-flex w-full flex-col gap-2 rounded-md border bg-card p-2">
      <span className="flex flex-wrap items-center gap-1">
        <Label className="mr-1 text-xs">Phase</Label>
        {PHASES.map(({ phase: p, short, name }) => (
          <Button
            key={p}
            type="button"
            size="sm"
            variant={p === draftPhase ? "default" : "outline"}
            disabled={pending}
            title={name}
            className="h-6 px-2 text-[11px]"
            onClick={() => setDraftPhase(p)}
          >
            {short}
          </Button>
        ))}
        <Button
          type="button"
          size="sm"
          variant={draftPhase === undefined ? "default" : "outline"}
          disabled={pending}
          className="h-6 px-2 text-[11px]"
          onClick={() => setDraftPhase(undefined)}
          title="No phase recorded — better than a wrong one"
        >
          Unknown
        </Button>
      </span>

      <span className="flex flex-wrap items-end gap-2">
        <span className="flex flex-col gap-1">
          <Label htmlFor="item-zone" className="text-xs">
            Drops in
          </Label>
          <Input
            id="item-zone"
            list="known-zones"
            value={zone}
            onChange={(e) => setZone(e.target.value)}
            placeholder="Serpentshrine Cavern"
            className="h-7 w-52 text-xs"
          />
          <datalist id="known-zones">
            {knownZones.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </span>
        <span className="flex flex-col gap-1">
          <Label htmlFor="item-boss" className="text-xs">
            From (optional)
          </Label>
          <Input
            id="item-boss"
            value={boss}
            onChange={(e) => setBoss(e.target.value)}
            placeholder="Lady Vashj"
            className="h-7 w-44 text-xs"
          />
        </span>
        <Button size="sm" className="h-7 text-xs" disabled={pending} onClick={save}>
          {pending && <Loader2 className="h-3 w-3 animate-spin" />}
          Save
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          disabled={pending}
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </span>
      {/* The other half of "what the app believes about this item", and the half
          that used to need a bug report: name, icon and quality are Wowhead's
          answer, and a confirmed row is never asked about again. */}
      <span className="flex flex-wrap items-center gap-1.5 border-t pt-2">
        <Label className="mr-1 text-xs">Name or icon wrong?</Label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-6 px-2 text-[11px]"
          disabled={pending}
          onClick={requeue}
          title="Ask Wowhead about this item again on the next backfill"
        >
          {pending && <Loader2 className="h-3 w-3 animate-spin" />}
          Look it up again
        </Button>
        <span className="text-[11px] text-muted-foreground">
          Queues one more lookup; the row keeps what it has until a better answer arrives. Your
          phase and source above are untouched.
        </span>
      </span>
      <span className="text-[11px] text-muted-foreground">
        Leave the zone empty to record nothing — the item drops off that raid&apos;s loot plan.{" "}
        {phase === undefined && source === undefined
          ? "Phase and drop source fill themselves in from Wowhead the next time the item resolver runs on the import page — set them here only if you want a different answer, or if Wowhead has none (heroics and world drops have no raid)."
          : "These came from Wowhead unless somebody set them here; whatever you save now is kept and never overwritten."}
      </span>
      {notice && <span className="text-[11px] text-success-ink">{notice}</span>}
      {error && <span className="text-[11px] text-destructive">{error}</span>}
    </span>
  );
}
