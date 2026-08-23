import type { Metadata } from "next";
import Link from "next/link";
import { getRepo } from "@/lib/data/repo";
import { PageHeader } from "@/components/page-header";
import { PHASES } from "@/lib/constants/wow";
import { LootPlanView } from "@/components/loot/loot-plan-view";

import { pageView } from "@/lib/auth/view";
import { can } from "@/lib/auth/can";
import { NoAccess } from "@/components/no-access";
export const metadata: Metadata = { title: "Loot plan" };

/**
 * The night's drops, decided before the raid.
 *
 * Zone comes from the URL so a plan is a link an officer can paste into
 * Discord — the council reads the same page, and nobody has to describe which
 * tab they are looking at.
 */
export default async function LootPlanPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const access = await pageView("loot.award", { returnTo: "/loot/plan" });
  if (!access.allowed) return <NoAccess reason={access.reason} />;

  const sp = await searchParams;
  const repo = await getRepo();
  const guild = await repo.getGuild();

  const zones = PHASES.flatMap((p) => p.zones);
  const activeZones = PHASES.find((p) => p.phase === guild.activePhase)?.zones ?? zones;
  const requested = Array.isArray(sp.zone) ? sp.zone[0] : sp.zone;
  const zone = zones.find((z) => z === requested) ?? activeZones[0] ?? zones[0];

  const plan = await repo.getLootPlan(zone);
  // Read for everyone who can see the plan; written only by whoever holds the
  // same capability that gates a note on a character or an item.
  const comments = await repo.listBossComments(zone);
  const canComment = can(access.viewer, "comments.write");
  // Same capability that gates "which boss does this item drop from" on the
  // item's own page — the identical judgement, noticed here instead.
  const canCurate = can(access.viewer, "items.curate");

  return (
    <div>
      <PageHeader
        title="Loot plan"
        description="What drops tonight and who it should go to, boss by boss. Read the contested rows before the pull; the rest is reference."
      >
        <Link
          href="/loot/priority"
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
        >
          Priority sheet
        </Link>
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {zones.map((z) => (
          <Link
            key={z}
            href={`/loot/plan?zone=${encodeURIComponent(z)}`}
            className={
              z === zone
                ? "rounded-md bg-accent px-2.5 py-1 text-sm font-medium"
                : "rounded-md px-2.5 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            }
          >
            {z}
          </Link>
        ))}
      </div>

      <LootPlanView
        plan={plan}
        comments={comments}
        canComment={canComment}
        canCurate={canCurate}
      />
    </div>
  );
}
