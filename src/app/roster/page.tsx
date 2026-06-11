import type { Metadata } from "next";
import Link from "next/link";
import { UserPlus } from "lucide-react";
import { getRepo } from "@/lib/data/repo";
import { PageHeader } from "@/components/page-header";
import { RosterTable, type RosterRow } from "@/components/roster-table";
import { Button } from "@/components/ui/button";

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
      >
        <Button asChild size="sm">
          <Link href="/roster/new">
            <UserPlus className="h-4 w-4" /> Add character
          </Link>
        </Button>
      </PageHeader>
      <RosterTable rows={rows} activePhase={guild.activePhase} />
    </div>
  );
}
