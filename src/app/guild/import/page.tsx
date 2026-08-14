import type { Metadata } from "next";
import { format, parseISO } from "date-fns";
import { getRepo } from "@/lib/data/repo";
import { findStaleReports } from "@/lib/analysis/stale-reports";
import { classifyAura } from "@/lib/wcl/consumables";
import { hasWclCredentials } from "@/lib/wcl/client";
import { PageHeader } from "@/components/page-header";
import { ImportTabs, type ImportPrefill } from "@/components/import/import-tabs";
import { ItemCacheCard } from "@/components/import/item-cache-card";
import { TierTokenCard } from "@/components/import/tier-token-card";
import { EnchantNamesCard } from "@/components/import/enchant-names-card";
import { PHASES } from "@/lib/constants/wow";

import { pageView } from "@/lib/auth/view";
import { NoAccess } from "@/components/no-access";
import { compareText } from "@/lib/sort";

export const metadata: Metadata = { title: "Import" };

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const access = await pageView("import.run", { returnTo: "/guild/import" });
  if (!access.allowed) return <NoAccess reason={access.reason} />;

  const sp = await searchParams;
  const prefill: ImportPrefill = {
    tab: first(sp.tab),
    character: first(sp.character),
    kind: first(sp.kind),
    phase: first(sp.phase),
  };

  const repo = await getRepo();
  const [
    characters,
    items,
    sessions,
    wclReports,
    unresolvedItems,
    unnamedEnchants,
    gearSets,
    tokenQueue,
    unmatchedSheetNames,
  ] = await Promise.all([
      repo.listCharacters(),
      repo.listItems(),
      repo.listRaidSessions(),
      repo.listWclReports(),
      repo.listUnresolvedItemIds(),
      repo.listUnnamedEnchantIds(),
      repo.listGearSets(),
      repo.listTokenBackfill(),
      repo.listUnmatchedSheetNames(),
    ]);

  /*
   * Reports a curation has overtaken. Each stores the auras its pulls carried
   * that the tables couldn't place; anything now recognised as a consumable
   * means re-importing would move a real number. An aura since ruled a class
   * buff is deliberately not a reason — see findStaleReports.
   */
  const staleByCode = new Map(
    findStaleReports(
      wclReports.map((r) => r.report),
      classifyAura,
    ).map((s) => [
      s.code,
      { pulls: s.pulls, learned: s.learned.map((a) => `${a.label} (${a.count} pulls)`) },
    ]),
  );

  const nameById = new Map(characters.map((c) => [c.character.id, c.character.name]));
  const existingSets = gearSets
    .map((set) => ({
      characterName: nameById.get(set.characterId) ?? "",
      kind: set.kind,
      phase: set.phase,
      name: set.name,
      source: set.source,
      slots: set.slots,
    }))
    .filter((s) => s.characterName !== "")
    .sort((a, b) => compareText(a.characterName, b.characterName) || (a.phase ?? 0) - (b.phase ?? 0));

  return (
    <div>
      <PageHeader
        title="Import"
        description="Bring in SixtyUpgrades sets (current gear & phase wishlists), Gargul loot exports and Warcraft Logs reports. Committing writes to the local database; re-imports update the existing data after you confirm."
      />
      <ImportTabs
        characters={characters.map((c) => c.character.name)}
        zones={PHASES.flatMap((p) => p.zones)}
        knownItems={items.map((i) => ({ id: i.id, name: i.name, quality: i.quality, icon: i.icon }))}
        sessions={sessions.map((s) => ({
          id: s.id,
          label: `${format(parseISO(s.date), "d MMM yyyy")} — ${s.zones.join(" + ")}`,
        }))}
        wclConfigured={hasWclCredentials()}
        wclReports={wclReports.map((r) => ({
          code: r.report.code,
          title: r.report.title,
          zone: r.report.zone,
          startTime: r.report.startTime,
          fetchedAt: r.report.fetchedAt,
          playerCount: r.playerCount,
          encounterCount: r.encounterCount,
          killCount: r.killCount,
          sessionLabel: r.session
            ? `${format(parseISO(r.session.date), "d MMM yyyy")} — ${r.session.zones.join(" + ")}`
            : undefined,
          // "Re-importing this would change what it says" — the report's own
          // record of what the app couldn't place, asked against today's tables.
          // Beside the refetch button rather than in a panel of its own: the
          // answer is only useful next to the thing it is asking for.
          stale: staleByCode.get(r.report.code),
        }))}
        existingSets={existingSets}
        prefill={prefill}
      />
      <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
        <ItemCacheCard
          unresolved={unresolvedItems.length}
          unmatchedSheetNames={unmatchedSheetNames.length}
        />
        <EnchantNamesCard unnamed={unnamedEnchants.length} />
        <TierTokenCard
          tokensToMap={tokenQueue.tokensWithoutPieces.length}
          unchecked={tokenQueue.unchecked.length}
        />
      </div>
    </div>
  );
}
