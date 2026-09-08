"use client";

import * as React from "react";
import { CircleAlert } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateSessionAction, type LootActionResult } from "@/app/loot/actions";
import { PHASES, phaseForZones } from "@/lib/constants/wow";
import { cn } from "@/lib/utils";

export interface SessionEditTarget {
  id: string;
  date: string;
  zones: string[];
  note?: string;
  /** Awards recorded under it — what the warnings below are counting. */
  count: number;
}

/** Every zone an import can be filed under, in phase order — same list the Gargul tab offers. */
const ALL_ZONES = PHASES.flatMap((p) => p.zones);

/**
 * Correct one Gargul import's own facts: the night, the raids, the note.
 *
 * Two things it says out loud rather than leaving to be discovered. Re-labelling
 * the **zones** moves the phase every award in the import counts in, and
 * fairness and contention read that phase — so this is the one field here that
 * can change a loot verdict. Moving the **date** moves the import's label and
 * nothing else: each award keeps the timestamp its paste gave it, which is the
 * same rule the award editor states from the other side.
 */
export function SessionEditDialog({
  target,
  onClose,
  onSaved,
}: {
  target: SessionEditTarget;
  onClose: () => void;
  /** Told the officer-facing result line so the ledger reports it where the other session actions do. */
  onSaved: (result: LootActionResult) => void;
}) {
  const [date, setDate] = React.useState(target.date);
  const [zones, setZones] = React.useState<string[]>(target.zones);
  const [note, setNote] = React.useState(target.note ?? "");
  const [error, setError] = React.useState<string>();
  const [pending, startTransition] = React.useTransition();

  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const canSubmit = validDate && zones.length > 0 && !pending;

  const wasPhase = phaseForZones(target.zones);
  const nowPhase = phaseForZones(zones);
  const phaseMoves = zones.length > 0 && nowPhase !== wasPhase;

  const toggleZone = (zone: string) =>
    setZones((prev) => (prev.includes(zone) ? prev.filter((z) => z !== zone) : [...prev, zone]));

  const submit = () => {
    setError(undefined);
    startTransition(async () => {
      const result = await updateSessionAction({
        sessionId: target.id,
        date,
        zones,
        note: note.trim() || undefined,
      });
      if (result.ok) {
        onSaved(result);
        onClose();
      } else {
        setError(result.message);
      }
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit import"
      description={`${target.count} award${target.count === 1 ? "" : "s"} recorded under it`}
    >
      <div className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">Raid date</Label>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-8"
            autoFocus
          />
          {/* The same disagreement the award editor warns about, from the
              session's side: an award carries the timestamp its Gargul line
              had, and moving the night it is filed under does not rewrite it. */}
          {date !== target.date && target.count > 0 && (
            <p className="text-[11px] text-muted-foreground">
              The {target.count} award{target.count === 1 ? "" : "s"} keep the date{" "}
              {target.count === 1 ? "it was" : "they were"} won on — re-date those individually if
              they moved too.
            </p>
          )}
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Zones raided</Label>
          <div className="flex flex-wrap gap-1.5">
            {ALL_ZONES.map((zone) => {
              const active = zones.includes(zone);
              return (
                <button
                  key={zone}
                  type="button"
                  onClick={() => toggleZone(zone)}
                  aria-pressed={active}
                  className={cn(
                    "cursor-pointer rounded-full border px-2.5 py-1 text-xs transition-colors",
                    active
                      ? "border-foreground/30 bg-primary text-primary-foreground"
                      : "hover:bg-accent",
                  )}
                >
                  {zone}
                </button>
              );
            })}
          </div>
          {zones.length === 0 && (
            <p className="text-[11px] text-warn-ink">Pick at least one zone.</p>
          )}
          {/* The one field here that re-ranks loot. Fairness and contention
              read the phase these zones derive, so say which way it moves
              before it is saved rather than after. */}
          {phaseMoves && (
            <p className="text-[11px] text-warn-ink">
              {nowPhase === undefined
                ? `These ${target.count} award${target.count === 1 ? "" : "s"} will stop counting in any phase.`
                : `These ${target.count} award${target.count === 1 ? "" : "s"} will count in phase ${nowPhase}${
                    wasPhase === undefined ? "" : ` instead of ${wasPhase}`
                  } — fairness and contention read that.`}
            </p>
          )}
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Note</Label>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Progress night…"
            className="h-8"
          />
        </div>

        {error && (
          <p className="flex items-start gap-1.5 rounded-md border border-danger-line bg-danger-soft p-2 text-xs text-danger-ink">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={!canSubmit}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
