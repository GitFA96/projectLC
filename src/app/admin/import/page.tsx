import type { Metadata } from "next";
import { getRepo } from "@/lib/data/repo";
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
  const [characters, items] = await Promise.all([repo.listCharacters(), repo.listItems()]);

  return (
    <div>
      <PageHeader
        title="Import"
        description="Bring in SixtyUpgrades sets (current gear & phase wishlists) and Gargul loot exports. Committing writes to the local database; re-imports update the existing set after you confirm."
      />
      <ImportTabs
        characters={characters.map((c) => c.character.name)}
        zones={PHASES.flatMap((p) => p.zones)}
        knownItems={items.map((i) => ({ id: i.id, name: i.name, quality: i.quality, icon: i.icon }))}
        prefill={prefill}
      />
    </div>
  );
}
