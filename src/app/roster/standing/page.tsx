import type { Metadata } from "next";
import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import { getRepo } from "@/lib/data/repo";
import { DEFAULT_POLICY } from "@/lib/analysis/policy";
import { PageHeader } from "@/components/page-header";
import { StandingBoardView, type StandingBoardRow } from "@/components/roster/standing-board";
import type { StandingBoard } from "@/lib/analysis/standing";
import type { WowClass } from "@/lib/constants/wow";

export const metadata: Metadata = { title: "Standing" };

export default async function StandingPage() {
  const repo = await getRepo();
  const [standing, characters, policy] = await Promise.all([
    repo.getRosterStanding(),
    repo.listCharacters(),
    repo.getGuildPolicy(),
  ]);

  // Still the placeholder? The stored policy resolves against the defaults, so
  // this compares rather than asking. A council that deliberately settles on
  // equal weights gets told they are unset, which is a small price for not
  // presenting the app's non-opinion as a recommendation.
  const weightsSet =
    JSON.stringify(policy.roster.weights) !== JSON.stringify(DEFAULT_POLICY.roster.weights);

  const byId = new Map(characters.map((c) => [c.character.id, c.character]));
  const withClass = (board: StandingBoard) => ({
    ...board,
    rows: board.rows.map((row): StandingBoardRow => {
      const character = byId.get(row.characterId);
      return {
        ...row,
        wowClass: (character?.class ?? "Warrior") as WowClass,
        spec: character?.spec ?? "",
      };
    }),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Standing"
        description="Who is carrying their weight, measured against the rest of this roster rather than a target. Weakest first — the board exists to answer a hard question, not to congratulate anyone."
      >
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
        >
          <SlidersHorizontal className="h-4 w-4" />
          Weighting
        </Link>
      </PageHeader>

      <StandingBoardView
        board={withClass(standing.mains)}
        weights={policy.roster.weights}
        minRaids={policy.roster.minRaids}
        weightsSet={weightsSet}
        title="Mains"
        subtitle="Placed against each other. An alt who raids occasionally would lift every regular above them, so they get their own board."
      />

      {standing.alts.rows.length > 0 && (
        <StandingBoardView
          board={withClass(standing.alts)}
          weights={policy.roster.weights}
          minRaids={policy.roster.minRaids}
          weightsSet={false}
          title="Alts and inactive"
          subtitle="Placed among themselves, and read differently: an alt is somebody's second character, not a seat to reconsider. Here to show what they contributed, not who to replace."
        />
      )}
    </div>
  );
}
