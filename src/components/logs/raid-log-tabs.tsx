"use client";

import type * as React from "react";
import { BarChart3, Coins, Trophy } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Splits the raid dashboard into "Overview" (preparation, uptime, cooldowns,
 * improvements), a "Rankings" leaderboard of in-fight usage, and "Gold spent"
 * (the total economic view incl. passive prep buffs). Panels are server-
 * rendered and handed in as nodes; this shell only owns the tab state.
 */
export function RaidLogTabs({
  overview,
  rankings,
  gold,
}: {
  overview: React.ReactNode;
  rankings: React.ReactNode;
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
      <TabsContent value="gold" className="space-y-4">
        {gold}
      </TabsContent>
    </Tabs>
  );
}
