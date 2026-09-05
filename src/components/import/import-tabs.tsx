"use client";

import { ManualSetTab, type ExistingSet } from "@/components/import/manual-set-tab";
import * as React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  makeItemResolver,
  type ImportPrefill,
  type ImportedReport,
  type KnownItem,
  type SessionOption,
} from "@/components/import/import-shared";
import { SixtyUpgradesTab } from "@/components/import/sixty-upgrades-tab";
import { GargulTab } from "@/components/import/gargul-tab";
import { WclTab } from "@/components/import/wcl-tab";

// The page reaches for these through this file, which is the one it already
// imports. Where they are defined is this directory's business, not its.
export type {
  ImportPrefill,
  ImportedReport,
  KnownItem,
  SessionOption,
} from "@/components/import/import-shared";

export function ImportTabs({
  characters,
  zones,
  knownItems,
  sessions,
  wclConfigured,
  wclReports,
  existingSets,
  prefill = {},
}: {
  characters: string[];
  zones: string[];
  knownItems: KnownItem[];
  sessions: SessionOption[];
  wclConfigured: boolean;
  wclReports: ImportedReport[];
  existingSets: ExistingSet[];
  prefill?: ImportPrefill;
}) {
  const items = React.useMemo(() => makeItemResolver(knownItems), [knownItems]);
  const defaultTab =
    prefill.tab === "gargul"
      ? "gargul"
      : prefill.tab === "wcl"
        ? "wcl"
        : prefill.tab === "manual"
          ? "manual"
          : "sixtyupgrades";
  return (
    <Tabs defaultValue={defaultTab}>
      <TabsList>
        <TabsTrigger value="sixtyupgrades">SixtyUpgrades sets</TabsTrigger>
        <TabsTrigger value="gargul">Gargul loot</TabsTrigger>
        <TabsTrigger value="wcl">Warcraft Logs</TabsTrigger>
        <TabsTrigger value="manual">By hand</TabsTrigger>
      </TabsList>
      <TabsContent value="sixtyupgrades">
        <SixtyUpgradesTab characters={characters} prefill={prefill} items={items} />
      </TabsContent>
      <TabsContent value="gargul">
        <GargulTab characters={characters} zones={zones} items={items} />
      </TabsContent>
      <TabsContent value="wcl">
        <WclTab sessions={sessions} configured={wclConfigured} reports={wclReports} />
      </TabsContent>
      <TabsContent value="manual">
        <ManualSetTab characters={characters} existingSets={existingSets} />
      </TabsContent>
    </Tabs>
  );
}
