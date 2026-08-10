"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { setActivePhaseAction } from "@/app/guild-actions";
import { Button } from "@/components/ui/button";
import { PHASES } from "@/lib/constants/wow";
import type { Phase } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Which phase the guild is raiding.
 *
 * Deliberately a set of buttons rather than a dropdown with a save: this is
 * meant to be flipped back and forth while an officer compares how the loot
 * would fall under one tier's rules and another's, and a control you have to
 * confirm doesn't get used that way. Nothing here is destructive — the phase
 * is one number, and putting it back restores every view that read it.
 */
export function ActivePhasePicker({ activePhase }: { activePhase: Phase }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [result, setResult] = React.useState<{ ok: boolean; message: string } | null>(null);
  // What the buttons show while the server catches up, so the click lands
  // immediately instead of a beat later when the route cache comes back.
  const [optimistic, setOptimistic] = React.useState<Phase | undefined>();
  const shown = optimistic ?? activePhase;

  const pick = (phase: Phase) => {
    if (phase === shown) return;
    setOptimistic(phase);
    setResult(null);
    startTransition(async () => {
      const next = await setActivePhaseAction(phase);
      setResult(next);
      if (!next.ok) setOptimistic(undefined);
      else router.refresh();
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {PHASES.map(({ phase, short, name }) => (
          <Button
            key={phase}
            type="button"
            size="sm"
            variant={phase === shown ? "default" : "outline"}
            disabled={pending}
            onClick={() => pick(phase)}
            title={name}
            className={cn("tabular-nums", phase === shown && "pointer-events-none")}
          >
            {short}
          </Button>
        ))}
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>
      {result && (
        <p className={result.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
          {result.message}
        </p>
      )}
    </div>
  );
}
