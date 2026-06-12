"use client";

import * as React from "react";
import { Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  purgeDemoData,
  setCharacterStatus,
  trackLogPlayer,
  type RosterActionResult,
} from "@/app/roster/actions";
import type { CharacterStatus } from "@/lib/constants/wow";
import type { UntrackedLogPlayer } from "@/lib/types";

function useRosterAction() {
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string>();
  const run = (action: () => Promise<RosterActionResult>) => {
    setError(undefined);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.message);
    });
  };
  return { pending, error, run };
}

function ErrorIcon({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <span title={error}>
      <TriangleAlert className="h-3.5 w-3.5 text-destructive" />
    </span>
  );
}

/** "Move to roster" / "Move to puggers" on character rows. */
export function StatusMoveButton({
  characterId,
  to,
  children,
}: {
  characterId: string;
  to: CharacterStatus;
  children: React.ReactNode;
}) {
  const { pending, error, run } = useRosterAction();
  return (
    <span className="inline-flex items-center gap-1">
      <Button
        variant="outline"
        size="sm"
        className="h-6 px-2 text-xs"
        disabled={pending}
        onClick={() => run(() => setCharacterStatus({ characterId, status: to }))}
      >
        {pending && <Loader2 className="h-3 w-3 animate-spin" />}
        {children}
      </Button>
      <ErrorIcon error={error} />
    </span>
  );
}

/** Track an untracked log name as a pugger, or add it straight to the roster. */
export function TrackPlayerButtons({ player }: { player: UntrackedLogPlayer }) {
  const { pending, error, run } = useRosterAction();
  const track = (status: "pug" | "main") =>
    run(() =>
      trackLogPlayer({
        name: player.name,
        className: player.className,
        spec: player.spec,
        wclRole: player.role,
        status,
      }),
    );
  return (
    <span className="inline-flex items-center gap-1">
      <Button
        variant="outline"
        size="sm"
        className="h-6 px-2 text-xs"
        disabled={pending}
        onClick={() => track("pug")}
      >
        {pending && <Loader2 className="h-3 w-3 animate-spin" />}
        Track as pugger
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-xs"
        disabled={pending}
        onClick={() => track("main")}
      >
        Add to roster
      </Button>
      <ErrorIcon error={error} />
    </span>
  );
}

/** Two-step destructive button: first click arms it, second click purges. */
export function PurgeDemoButton() {
  const { pending, error, run } = useRosterAction();
  const [armed, setArmed] = React.useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant={armed ? "destructive" : "outline"}
        size="sm"
        disabled={pending}
        onClick={() => {
          if (!armed) {
            setArmed(true);
            return;
          }
          run(purgeDemoData);
        }}
        onBlur={() => setArmed(false)}
      >
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {armed ? "Click again to confirm" : "Remove demo data"}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
