"use client";

import type * as React from "react";
import { FlaskConical, LineChart, ListChecks } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Splits one report's performance view into "Overview" (pulls, consumables,
 * gear — server-rendered and handed in as a node), "Fight graph" (the
 * live-fetched DPS timeline) and "Sim" (this raider's pulls against their
 * wowsims setup). This shell only owns the tab state.
 */
export function PerformanceTabs({
  overview,
  graph,
  sim,
}: {
  overview: React.ReactNode;
  graph: React.ReactNode;
  sim?: React.ReactNode;
}) {
  return (
    <Tabs defaultValue="overview" className="space-y-4">
      <TabsList>
        <TabsTrigger value="overview">
          <ListChecks className="h-3.5 w-3.5" /> Overview
        </TabsTrigger>
        <TabsTrigger value="graph">
          <LineChart className="h-3.5 w-3.5" /> Fight graph
        </TabsTrigger>
        {sim && (
          <TabsTrigger value="sim">
            <FlaskConical className="h-3.5 w-3.5" /> Sim
          </TabsTrigger>
        )}
      </TabsList>
      <TabsContent value="overview" className="space-y-4">
        {overview}
      </TabsContent>
      <TabsContent value="graph" className="space-y-4">
        {graph}
      </TabsContent>
      {sim && (
        <TabsContent value="sim" className="space-y-4">
          {sim}
        </TabsContent>
      )}
    </Tabs>
  );
}
