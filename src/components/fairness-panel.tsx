"use client";

import * as React from "react";
import { FairnessBars, type FairnessBarEntry } from "@/components/fairness-bars";
import type { Phase } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface FairnessGroupView {
  phase: Phase | "all";
  entries: FairnessBarEntry[];
}

type Scope = "main" | "alt" | "everyone";

const SCOPE_LABEL: Record<Scope, string> = {
  main: "Mains",
  alt: "Alts & splits",
  everyone: "Everyone",
};

function Pill({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "cursor-pointer rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        selected && "border-transparent bg-accent text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * FairnessBars with two scopes: which phase, and whose loot.
 *
 * Phase defaults to the guild's active one — the council's usual "who's owed
 * loot right now". Roster defaults to mains, because a main and a split run
 * are not competing for the same loot and a single list ranks them as if they
 * were.
 *
 * The two lists are deliberately not added together. Whether an alt's loot
 * counts against its main is a policy question the guild has to answer out
 * loud; showing them apart asks it, while quietly summing them would answer it.
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
  const [scope, setScope] = React.useState<Scope>("main");
  const active = groups.find((g) => g.phase === selected) ?? groups[0];

  // Only offer a split the roster actually has. Entries from before `status`
  // was passed have none, and read as mains rather than disappearing.
  const hasAlts = groups.some((g) => g.entries.some((e) => e.status === "alt"));
  const entries = (active?.entries ?? []).filter((e) => {
    if (!hasAlts || scope === "everyone") return true;
    return scope === "alt" ? e.status === "alt" : e.status !== "alt";
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1">
        {groups.map((g) => (
          <Pill key={String(g.phase)} selected={g.phase === selected} onClick={() => setSelected(g.phase)}>
            {g.phase === "all" ? "All raids" : `P${g.phase}`}
          </Pill>
        ))}
        {hasAlts && (
          <>
            <span className="mx-1 h-3 w-px bg-border" aria-hidden />
            {(["main", "alt", "everyone"] as const).map((s) => (
              <Pill key={s} selected={s === scope} onClick={() => setScope(s)}>
                {SCOPE_LABEL[s]}
              </Pill>
            ))}
          </>
        )}
      </div>
      {entries.length > 0 ? (
        <FairnessBars entries={entries} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Nobody on this roster has an award in {selected === "all" ? "any raid" : `phase ${selected}`}.
        </p>
      )}
    </div>
  );
}
