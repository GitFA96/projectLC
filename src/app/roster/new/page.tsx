import type { Metadata } from "next";
import { getRepo } from "@/lib/data/repo";
import { PageHeader } from "@/components/page-header";
import { CharacterForm, OffSpecCard, type MainOption } from "@/components/character-form";

import { pageView } from "@/lib/auth/view";
import { NoAccess } from "@/components/no-access";
import { compareText } from "@/lib/sort";

export const metadata: Metadata = { title: "Add character" };

export default async function NewCharacterPage() {
  const access = await pageView("roster.edit", { returnTo: "/roster" });
  if (!access.allowed) return <NoAccess reason={access.reason} />;

  const repo = await getRepo();
  const mains: MainOption[] = (await repo.listCharacters())
    .filter((s) => s.character.status !== "pug")
    .map((s) => ({ id: s.character.id, name: s.character.name, wowClass: s.character.class }))
    .sort((a, b) => compareText(a.name, b.name));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Add character"
        description="New raider joins the roster — imports and Gargul winner matching go by this name."
      />
      <div className="max-w-2xl space-y-4">
        <CharacterForm mains={mains} />
        <OffSpecCard />
      </div>
    </div>
  );
}
