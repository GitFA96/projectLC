"use client";

import type * as React from "react";
import { BarChart3, Coins, Trophy, Users } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Splits the raid dashboard into "Overview" (preparation, uptime, cooldowns,
 * improvements), a "Rankings" leaderboard of in-fight usage, "Groups" (which
 * groups the night was run in — the same board the raid planner shows) and
 * "Gold spent" (the total economic view incl. passive prep buffs). Panels are
 * server-rendered and handed in as nodes; this shell only owns the tab state.
 */
export function RaidLogTabs({
  overview,
  rankings,
  board,
  gold,
}: {
  overview: React.ReactNode;
  rankings: React.ReactNode;
  board: React.ReactNode;
  gold: React.ReactNode;
}) {
  return (
    <Tabs defaultValue="overview" className="space-y-4">
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
    </Tabs>
  );
}
