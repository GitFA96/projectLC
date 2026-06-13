import type { Metadata } from "next";
import { getRepo } from "@/lib/data/repo";
import { PageHeader } from "@/components/page-header";
import { CharacterForm, type MainOption } from "@/components/character-form";

export const metadata: Metadata = { title: "Add character" };

export default async function NewCharacterPage() {
  const repo = await getRepo();
  const mains: MainOption[] = (await repo.listCharacters())
    .filter((s) => s.character.status !== "pug")
    .map((s) => ({ id: s.character.id, name: s.character.name, wowClass: s.character.class }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Add character"
        description="New raider joins the roster — imports and Gargul winner matching go by this name."
      />
      <CharacterForm mains={mains} />
    </div>
  );
}
