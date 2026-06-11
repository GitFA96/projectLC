import type { Metadata } from "next";
import { getRepo } from "@/lib/data/repo";
import { PageHeader } from "@/components/page-header";
import { ImportTabs } from "@/components/import/import-tabs";
import { PHASES } from "@/lib/constants/wow";

export const metadata: Metadata = { title: "Import" };

export default async function ImportPage() {
  const repo = await getRepo();
  const characters = await repo.listCharacters();

  return (
    <div>
      <PageHeader
        title="Import"
        description="Bring in SixtyUpgrades sets (current gear & phase wishlists) and Gargul loot exports. Milestone 1 previews the parse; committing lands with persistence in Milestone 2."
      />
      <ImportTabs
        characters={characters.map((c) => c.character.name)}
        zones={PHASES.flatMap((p) => p.zones)}
      />
    </div>
  );
}
