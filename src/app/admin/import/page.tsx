import type { Metadata } from "next";
import { format, parseISO } from "date-fns";
import { getRepo } from "@/lib/data/repo";
import { hasWclCredentials } from "@/lib/wcl/client";
import { PageHeader } from "@/components/page-header";
import { ImportTabs, type ImportPrefill } from "@/components/import/import-tabs";
import { PHASES } from "@/lib/constants/wow";

export const metadata: Metadata = { title: "Import" };

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const prefill: ImportPrefill = {
    tab: first(sp.tab),
    character: first(sp.character),
    kind: first(sp.kind),
    phase: first(sp.phase),
  };

  const repo = await getRepo();
  const [characters, items, sessions] = await Promise.all([
    repo.listCharacters(),
    repo.listItems(),
    repo.listRaidSessions(),
  ]);

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
        prefill={prefill}
      />
    </div>
  );
}
