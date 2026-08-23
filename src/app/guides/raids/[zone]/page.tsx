import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getRepo } from "@/lib/data/repo";
import { bossKey } from "@/lib/constants/wow";
import { findGuides, raidSections, zoneFromSlug, zoneSlug } from "@/lib/guides";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { pageView } from "@/lib/auth/view";
import { NoAccess } from "@/components/no-access";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ zone: string }>;
}): Promise<Metadata> {
  const { zone } = await params;
  return { title: zoneFromSlug(zone) ?? "Raid guide" };
}

/**
 * One raid: its bosses, in the order the raid meets them.
 *
 * Each row says what is known about that boss rather than only whether somebody
 * has written about him — the drop count comes from the same table the loot
 * plan reads, so a boss with no drops mapped is visible here too. A raid guide
 * that talked about fights while the drop table sat empty would be a page
 * nobody could act on.
 */
export default async function RaidGuidePage({
  params,
}: {
  params: Promise<{ zone: string }>;
}) {
  const access = await pageView("guild.view", { returnTo: "/guides" });
  if (!access.allowed) return <NoAccess reason={access.reason} />;

  const { zone: slug } = await params;
  const zone = zoneFromSlug(slug);
  if (!zone) notFound();

  const repo = await getRepo();
  const [guides, guild, drops] = await Promise.all([
    repo.listGuides(),
    repo.getGuild(),
    repo.getDropTable(zone),
  ]);

  const dropCount = new Map<string, number>();
  for (const drop of drops) {
    dropCount.set(drop.bossKey, (dropCount.get(drop.bossKey) ?? 0) + 1);
  }

  return (
    <div>
      <PageHeader
        title={zone}
        description="Every boss the raid meets, in order. What each drops comes from the shared drop table; what to do about it is yours."
      >
        <Link
          href="/guides"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          All guides
        </Link>
      </PageHeader>

      <div className="space-y-2">
        {raidSections(zone).map((boss) => {
          const pair = findGuides(guides, "raid", zone, boss, guild.id);
          const count = dropCount.get(bossKey(boss)) ?? 0;
          return (
            <Link
              key={boss}
              href={`/guides/raids/${zoneSlug(zone)}/${zoneSlug(boss)}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 transition-colors hover:bg-accent"
            >
              <span className="font-medium">{boss}</span>
              <span className="flex flex-wrap items-center gap-2">
                {pair.own && (
                  <Badge variant="secondary" className="font-normal">
                    ours
                  </Badge>
                )}
                {pair.template && (
                  <Badge variant="muted" className="font-normal">
                    shared
                  </Badge>
                )}
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {count === 0 ? "no drops mapped" : `${count} drop${count === 1 ? "" : "s"}`}
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
