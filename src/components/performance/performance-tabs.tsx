"use client";

import type * as React from "react";
import { LineChart, ListChecks } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Splits one report's performance view into "Overview" (pulls, consumables,
 * gear — server-rendered and handed in as a node) and "Fight graph" (the
 * live-fetched DPS timeline). This shell only owns the tab state.
 */
export function PerformanceTabs({
  overview,
  graph,
}: {
  overview: React.ReactNode;
  graph: React.ReactNode;
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
      </TabsList>
      <TabsContent value="overview" className="space-y-4">
        {overview}
      </TabsContent>
      <TabsContent value="graph" className="space-y-4">
        {graph}
      </TabsContent>
    </Tabs>
  );
}
