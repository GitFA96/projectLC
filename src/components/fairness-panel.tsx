"use client";

import * as React from "react";
import { FairnessBars, type FairnessBarEntry } from "@/components/fairness-bars";
import type { Phase } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface FairnessGroupView {
  phase: Phase | "all";
  entries: FairnessBarEntry[];
}

/**
 * FairnessBars with a phase scope: "All raids" plus one pill per phase that
 * has awards. Defaults to the guild's active phase — the council's usual
 * "who's owed loot right now" question.
 */
export function FairnessPanel({
  groups,
  defaultPhase,
}: {
  groups: FairnessGroupView[];
  defaultPhase?: Phase;
}) {
  const [selected, setSelected] = React.useState<Phase | "all">(
    defaultPhase !== undefined && groups.some((g) => g.phase === defaultPhase) ? defaultPhase : "all",
  );
  const active = groups.find((g) => g.phase === selected) ?? groups[0];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {groups.map((g) => (
          <button
            key={String(g.phase)}
            type="button"
            onClick={() => setSelected(g.phase)}
            className={cn(
              "cursor-pointer rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
              g.phase === selected && "border-transparent bg-accent text-foreground",
            )}
          >
            {g.phase === "all" ? "All raids" : `P${g.phase}`}
          </button>
        ))}
      </div>
      {active && <FairnessBars entries={active.entries} />}
    </div>
  );
}
