"use client";

import * as React from "react";
import type { RaidFight } from "@/lib/types";
import type { RaidDispelView } from "@/lib/analysis/dispels";
import type { RaidInterruptView } from "@/lib/analysis/interrupts";
import { DispelSections } from "@/components/logs/dispel-board";
import { InterruptSections } from "@/components/logs/interrupt-board";
import { CollapsibleCard } from "@/components/logs/collapsible-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * One card for the two jobs that answer the enemy's casting: what we took off,
 * and what we stopped.
 *
 * They were six collapsible cards before this — three per board — which is most
 * of the Overview's fold count for two questions an officer asks together. A
 * shaman's night is Cure Toxins and Earth Shock, and a mage's is Remove Curse
 * and Counterspell; putting them one tab apart is closer to how they are read.
 *
 * The two halves stay genuinely separate inside, and deliberately so. They are
 * not the same measurement — a dispel is an aura removed and an interrupt is a
 * cast stopped, only one of which has a denominator — so nothing here merges
 * their numbers or ranks a raider across both.
 */
export function DispelInterruptBoard({
  fights,
  dispels,
  interrupts,
}: {
  fights: RaidFight[];
  dispels: RaidDispelView;
  interrupts: RaidInterruptView;
}) {
  /*
   * The tab with something in it opens first.
   *
   * Not a fixed default, because the empty half is a real and common state: a
   * report imported after dispels shipped but before interrupts did has one and
   * not the other, and opening on the empty one reads as "this night had none"
   * until you click. Dispels win a tie only because they came first.
   */
  const defaultTab = dispels.total === 0 && interrupts.total > 0 ? "interrupts" : "dispels";

  return (
    <CollapsibleCard
      title="Dispels & interrupts"
      description="What we took off — decurses, cleanses, poison removal and buffs stripped off the enemy — and what we stopped, with kicks, pummels, shocks and counterspells. Neither is scored: what a raid should dispel or interrupt is an assignment the council makes."
    >
      <Tabs defaultValue={defaultTab}>
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="dispels">
            Dispels
            {/*
              The count sits in the tab so the fold can be judged without
              opening both. A zero is left off rather than shown: "Dispels 0"
              claims the raid dispelled nothing, when it may only mean this
              report predates the tracking — a distinction each half spells out
              in full once its tab is open.
            */}
            {dispels.total > 0 && (
              <span className="ml-1 text-[10px] tabular-nums text-muted-foreground">
                {dispels.total}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="interrupts">
            Interrupts
            {interrupts.total > 0 && (
              <span className="ml-1 text-[10px] tabular-nums text-muted-foreground">
                {interrupts.total}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dispels">
          <DispelSections fights={fights} dispels={dispels} />
        </TabsContent>
        <TabsContent value="interrupts">
          <InterruptSections fights={fights} interrupts={interrupts} />
        </TabsContent>
      </Tabs>
    </CollapsibleCard>
  );
}
