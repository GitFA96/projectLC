import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getRepo } from "@/lib/data/repo";
import { PageHeader } from "@/components/page-header";
import { CharacterForm, type MainOption } from "@/components/character-form";
import { GearSetManager, type GearSetRow } from "@/components/gear-set-manager";
import type { GearSet } from "@/lib/types";

type Params = { name: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  return { title: `Edit ${decoded.charAt(0).toUpperCase() + decoded.slice(1)}` };
}

function toRow(set: GearSet): GearSetRow {
  return {
    id: set.id,
    name: set.name,
    kind: set.kind,
    phase: set.phase,
    importedAt: set.importedAt,
    slotCount: set.slots.length,
    source: set.source,
  };
}

export default async function CharacterEditPage({ params }: { params: Promise<Params> }) {
  const { name } = await params;
  const repo = await getRepo();
  const bundle = await repo.getCharacterBundle(decodeURIComponent(name));
  if (!bundle) notFound();

  // Candidate mains: every other guild character (a main is never a pug).
  const mains: MainOption[] = (await repo.listCharacters())
    .filter((s) => s.character.id !== bundle.character.id && s.character.status !== "pug")
    .map((s) => ({ id: s.character.id, name: s.character.name, wowClass: s.character.class }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const sets: GearSetRow[] = [
    ...(bundle.current ? [toRow(bundle.current)] : []),
    ...bundle.wishlists.map((w) => toRow(w.set)),
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Edit ${bundle.character.name}`}
        description="Character details and imported gear sets."
      />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <CharacterForm character={bundle.character} mains={mains} />
        <GearSetManager sets={sets} characterName={bundle.character.name} />
      </div>
    </div>
  );
}
