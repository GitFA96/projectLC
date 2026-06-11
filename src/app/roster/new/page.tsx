import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { CharacterForm } from "@/components/character-form";

export const metadata: Metadata = { title: "Add character" };

export default function NewCharacterPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Add character"
        description="New raider joins the roster — imports and Gargul winner matching go by this name."
      />
      <CharacterForm />
    </div>
  );
}
