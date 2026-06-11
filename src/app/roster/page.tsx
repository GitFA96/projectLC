import type { Metadata } from "next";
import { getRepo } from "@/lib/data/repo";
import { PageHeader } from "@/components/page-header";
import { RosterTable, type RosterRow } from "@/components/roster-table";

export const metadata: Metadata = { title: "Roster" };

export default async function RosterPage() {
  const repo = await getRepo();
  const [guild, summaries] = await Promise.all([repo.getGuild(), repo.listCharacters()]);

  const rows: RosterRow[] = summaries.map((s) => ({
    name: s.character.name,
    wowClass: s.character.class,
    spec: s.character.spec,
    role: s.character.role,
    status: s.character.status,
    completions: s.completionByPhase.map((c) => ({ phase: c.phase, pct: c.completion.pct })),
    totalAwards: s.totalAwards,
    activePhaseAwards: s.activePhaseAwards,
    offspecAwards: s.offspecAwards,
    lastAwardAt: s.lastAwardAt,
    hasCurrentGear: s.hasCurrentGear,
  }));

  return (
    <div>
      <PageHeader
        title="Roster"
        description="Wishlist progress and loot received per character — click a name for the full profile."
      />
      <RosterTable rows={rows} activePhase={guild.activePhase} />
    </div>
  );
}
