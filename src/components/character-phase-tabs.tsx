"use client";

import Link from "next/link";
import { format, parseISO } from "date-fns";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { WishlistTable, type WishlistRowView } from "@/components/wishlist-table";
import { AwardItemButton, type AwardContext } from "@/components/award-item-controls";
import { ItemLink } from "@/components/item-link";
import { StatDeltaPanel } from "@/components/stat-delta-panel";
import { EmptyState } from "@/components/empty-state";
import { PHASES, SLOT_LABELS } from "@/lib/constants/wow";
import type { Phase, StatDeltaRow } from "@/lib/types";

export interface PhaseTabView {
  phase: Phase;
  setName: string;
  source: string;
  importedAt: string;
  completion: { satisfied: number; total: number; pct: number };
  rows: WishlistRowView[];
  statDeltas: StatDeltaRow[];
}

function importHref(characterName: string, phase?: Phase): string {
  const base = `/guild/import?character=${encodeURIComponent(characterName)}&kind=wishlist`;
  return phase ? `${base}&phase=${phase}` : base;
}

/**
 * P1–P5 wishlist tabs: per phase a wishlist table (with acquired status) and
 * the "upcoming stats" delta panel. Phases without an imported set are
 * disabled but visible — the roadmap is part of the picture. Every tab links
 * back to the prefilled import so updating a wishlist is one click away.
 */
export function CharacterPhaseTabs({
  tabs,
  activePhase,
  hasCurrent,
  characterName,
  characterId,
  award,
}: {
  tabs: PhaseTabView[];
  activePhase: Phase;
  hasCurrent: boolean;
  characterName: string;
  /** Enables editing per-slot fallbacks. Omit and they render read-only. */
  characterId?: string;
  /** Enables awarding a wishlist row (and clearing it) straight from the table. */
  award?: AwardContext;
}) {
  const byPhase = new Map(tabs.map((t) => [t.phase, t]));
  if (tabs.length === 0) {
    return (
      <EmptyState
        title="No wishlists imported"
        description="Import this character's SixtyUpgrades phase sets to track wanted items, acquisition status and the stat upgrades they represent."
        action={
          <Button asChild size="sm">
            <Link href={importHref(characterName)}>Import a wishlist</Link>
          </Button>
        }
      />
    );
  }
  const defaultPhase = byPhase.has(activePhase) ? activePhase : tabs[0].phase;

  return (
    <Tabs defaultValue={String(defaultPhase)}>
      <TabsList>
        {PHASES.map(({ phase, short }) => (
          <TabsTrigger
            key={phase}
            value={String(phase)}
            disabled={!byPhase.has(phase)}
            title={byPhase.has(phase) ? undefined : `No ${short} wishlist imported`}
          >
            {short}
            {byPhase.has(phase) && (
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {byPhase.get(phase)!.completion.pct}%
              </span>
            )}
          </TabsTrigger>
        ))}
      </TabsList>

      {tabs.map((tab) => {
        // Open slots, plus any slot an officer satisfied by hand: a pin that
        // closed a row has to stay visible, or there's nowhere left to undo it.
        const openRows = tab.rows.filter((r) => r.state !== "equipped" || r.currentPick?.pinned);
        // Worn, but the ledger has no award for it — gear from before loot
        // tracking, a Gargul paste that missed a line, a trade after the raid.
        // The row is otherwise closed and invisible, so this is the only place
        // an officer can put a date on how they got it.
        const unrecorded = tab.rows.filter((r) => r.state === "equipped" && !r.awardId);
        return (
          <TabsContent key={tab.phase} value={String(tab.phase)} className="space-y-4">
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle>
                    {tab.setName} — {tab.completion.pct}% satisfied
                  </CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {tab.completion.satisfied} of {tab.completion.total} wishlist slots equipped or awarded
                  </p>
                </div>
                <div className="w-32">
                  <Progress value={tab.completion.pct} indicatorClassName="bg-success" />
                </div>
              </CardHeader>
              <CardContent>
                <WishlistTable
                  rows={openRows}
                  characterName={characterName}
                  award={award}
                  alternativesFor={characterId ? { characterId, phase: tab.phase } : undefined}
                />
                {award && unrecorded.length > 0 && (
                  <details className="mt-3 rounded-md border bg-muted/30 p-2.5">
                    <summary className="cursor-pointer text-xs font-medium">
                      {unrecorded.length} equipped with no loot record
                      <span className="ml-1 font-normal text-muted-foreground">
                        — file when {characterName} got {unrecorded.length === 1 ? "it" : "them"}
                      </span>
                    </summary>
                    <ul className="mt-2 space-y-1">
                      {unrecorded.map((row) => (
                        <li key={row.slot} className="flex items-center gap-2">
                          <span className="w-16 shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">
                            {SLOT_LABELS[row.slot]}
                          </span>
                          <span className="min-w-0 flex-1">
                            <ItemLink item={row.wished} size="sm" />
                          </span>
                          <AwardItemButton ctx={award} prefill={row.wished} label="Record" />
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Pick the raid night it was won on — or “New manual entry” to set any date.
                      Filing one puts it in the ledger, the fairness counts and loot-owed.
                    </p>
                  </details>
                )}
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Imported {format(parseISO(tab.importedAt), "d MMM yyyy")} · source: {tab.source} ·{" "}
                  <Link
                    href={importHref(characterName, tab.phase)}
                    className="font-medium text-foreground underline-offset-2 hover:underline"
                  >
                    Update this wishlist
                  </Link>
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Upcoming stats</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Current gear vs this wishlist — straight diff of the SixtyUpgrades stat blocks.
                </p>
              </CardHeader>
              <CardContent>
                <StatDeltaPanel deltas={tab.statDeltas} hasCurrent={hasCurrent} />
              </CardContent>
            </Card>
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
