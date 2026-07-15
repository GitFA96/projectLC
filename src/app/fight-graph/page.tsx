import type { Metadata } from "next";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { getRepo } from "@/lib/data/repo";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import {
  FightGraphCompare,
  type PickerReport,
} from "@/components/performance/fight-graph-compare";

export const metadata: Metadata = { title: "Fight graph" };

/**
 * The fight-graph playground: pick any (player, raid, fight) instance — or
 * two, including the same player across different raids — and study DPS,
 * cooldown/consume usage, boss health and buff windows overlaid on one time
 * axis, side by side, or stacked. Graph data is fetched live from WCL per
 * instance; this page only ships the picker options.
 */
export default async function FightGraphPage() {
  const repo = await getRepo();
  const reports = await repo.listWclReports();

  const pickers: PickerReport[] = (
    await Promise.all(
      reports.map(async ({ report }): Promise<PickerReport | null> => {
        const view = await repo.getRaidReport(report.code);
        if (!view) return null;
        return {
          code: report.code,
          title: report.title,
          dateLabel: format(parseISO(report.startTime), "d MMM"),
          zone: report.zone ?? undefined,
          fights: view.fights.map((f) => ({
            fightId: f.fightId,
            encounterName: f.encounterName,
            kill: f.kill,
            fightPercentage: f.fightPercentage,
          })),
          players: view.usage.map((u) => u.name).sort((a, b) => a.localeCompare(b)),
        };
      }),
    )
  ).filter((r): r is PickerReport => r !== null);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Fight graph"
        description="Any player, any raid, any pull — DPS over the fight with cooldowns, consumables, boss health and buff windows. Compare up to four instances (different players, or the same player across raids) overlaid, side by side, or stacked."
      />
      {pickers.length === 0 ? (
        <EmptyState
          title="No Warcraft Logs imported yet"
          description="Import a report on the Warcraft Logs tab of the import page — every pull becomes graphable here."
          action={
            <Button asChild size="sm">
              <Link href="/admin/import?tab=wcl">Import a report</Link>
            </Button>
          }
        />
      ) : (
        <FightGraphCompare reports={pickers} />
      )}
    </div>
  );
}
