"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Globe, Loader2 } from "lucide-react";
import { setGuildVisibilityAction } from "@/app/guild-actions";
import { Button } from "@/components/ui/button";
import { VISIBILITY_LADDER, VISIBILITY_META, type GuildVisibility } from "@/lib/analysis/public-profile";
import { cn } from "@/lib/utils";

/**
 * How much of itself this guild publishes.
 *
 * Three named presets rather than a grid of toggles, and that is a decision
 * rather than a simplification (§6): a per-field visibility surface is one no
 * guild will get right, and getting it wrong is silent — nothing fails, nobody
 * is told, and the guild finds out when a rival quotes its own roster back.
 *
 * The presets move only the WCL-shaped list. None of them, at any setting,
 * reaches the loot ledger, the priority sheet, standing, attendance or a
 * council comment. That is not a preset anybody can pick.
 */
export function VisibilityPicker({ current }: { current: GuildVisibility }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [optimistic, setOptimistic] = React.useState<GuildVisibility | undefined>();
  const [result, setResult] = React.useState<{ ok: boolean; message: string } | null>(null);
  const shown = optimistic ?? current;

  const pick = (visibility: GuildVisibility) => {
    if (visibility === shown) return;
    setOptimistic(visibility);
    setResult(null);
    startTransition(async () => {
      const next = await setGuildVisibilityAction(visibility);
      setResult(next);
      if (!next.ok) setOptimistic(undefined);
      else router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {VISIBILITY_LADDER.map((v) => (
          <Button
            key={v}
            type="button"
            size="sm"
            variant={v === shown ? "default" : "outline"}
            disabled={pending}
            onClick={() => pick(v)}
            className={cn(v === shown && "pointer-events-none")}
          >
            {v === shown && <Globe className="h-3.5 w-3.5" />}
            {VISIBILITY_META[v].label}
          </Button>
        ))}
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>

      <p className="text-xs text-muted-foreground">{VISIBILITY_META[shown].blurb}</p>
      <p className="text-xs text-muted-foreground">
        No setting here ever publishes the loot ledger, the priority sheet, standing, attendance or
        a council note. Those are the guild&apos;s own judgements and stay inside, whatever this
        says.
      </p>
      {result && (
        <p className={result.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
          {result.message}
        </p>
      )}
    </div>
  );
}
