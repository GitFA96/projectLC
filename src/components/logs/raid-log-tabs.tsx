"use client";

import type * as React from "react";
import { BarChart3, Coins, FlaskConical, Trophy, Users } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Splits the raid dashboard into "Overview" (preparation, uptime, cooldowns,
 * improvements), a "Rankings" leaderboard of in-fight usage, "Groups" (which
 * groups the night was run in — the same board the raid planner shows), "Gold
 * spent" (the total economic view incl. passive prep buffs) and "Preparedness"
 * (what each raider brought, pull by pull). Panels are server-rendered and
 * handed in as nodes; this shell only owns the tab state.
 *
 * `defaultTab` exists so a scoped preparedness link opens on the tab it
 * describes: the scope rides in the URL, and landing on Overview would leave
 * the reader to guess where the link meant to point.
 */
export function RaidLogTabs({
  overview,
  rankings,
  board,
  gold,
  preparedness,
  defaultTab = "overview",
}: {
  overview: React.ReactNode;
  rankings: React.ReactNode;
  board: React.ReactNode;
  gold: React.ReactNode;
  preparedness: React.ReactNode;
  defaultTab?: string;
}) {
  return (
    <Tabs defaultValue={defaultTab} className="space-y-4">
      <TabsList>
        <TabsTrigger value="overview">
          <BarChart3 className="h-3.5 w-3.5" /> Overview
        </TabsTrigger>
        <TabsTrigger value="rankings">
          <Trophy className="h-3.5 w-3.5" /> Rankings
        </TabsTrigger>
        {/* "Groups", not "Board": this is one night's arrangement, and
            the word that used to name the whole section now names the page it
            lives on. */}
        <TabsTrigger value="board">
          <Users className="h-3.5 w-3.5" /> Groups
        </TabsTrigger>
        <TabsTrigger value="gold">
          <Coins className="h-3.5 w-3.5" /> Gold spent
        </TabsTrigger>
        <TabsTrigger value="preparedness">
          <FlaskConical className="h-3.5 w-3.5" /> Preparedness
        </TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="space-y-4">
        {overview}
      </TabsContent>
      <TabsContent value="rankings" className="space-y-4">
        {rankings}
      </TabsContent>
      <TabsContent value="board" className="space-y-4">
        {board}
      </TabsContent>
      <TabsContent value="gold" className="space-y-4">
        {gold}
      </TabsContent>
      <TabsContent value="preparedness" className="space-y-4">
        {preparedness}
      </TabsContent>
    </Tabs>
  );
}
