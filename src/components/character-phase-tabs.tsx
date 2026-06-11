"use client";

import { format, parseISO } from "date-fns";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { WishlistTable, type WishlistRowView } from "@/components/wishlist-table";
import { StatDeltaPanel } from "@/components/stat-delta-panel";
import { EmptyState } from "@/components/empty-state";
import { PHASES } from "@/lib/constants/wow";
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

/**
 * P1–P5 wishlist tabs: per phase a wishlist table (with acquired status) and
 * the "upcoming stats" delta panel. Phases without an imported set are
 * disabled but visible — the roadmap is part of the picture.
 */
export function CharacterPhaseTabs({
  tabs,
  activePhase,
  hasCurrent,
}: {
  tabs: PhaseTabView[];
  activePhase: Phase;
  hasCurrent: boolean;
}) {
  const byPhase = new Map(tabs.map((t) => [t.phase, t]));
  if (tabs.length === 0) {
    return (
      <EmptyState
        title="No wishlists imported"
        description="Import this character's SixtyUpgrades phase sets to track wanted items, acquisition status and the stat upgrades they represent."
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
        const openRows = tab.rows.filter((r) => r.state !== "equipped");
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
                  <Progress value={tab.completion.pct} indicatorClassName="bg-emerald-500" />
                </div>
              </CardHeader>
              <CardContent>
                <WishlistTable rows={openRows} />
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Imported {format(parseISO(tab.importedAt), "d MMM yyyy")} · source: {tab.source}
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
