import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getRepo } from "@/lib/data/repo";
import { bossKey } from "@/lib/constants/wow";
import { bossFromSlug, findGuides, zoneFromSlug, zoneSlug } from "@/lib/guides";
import { guidePermissions } from "@/app/guides/actions";
import { PageHeader } from "@/components/page-header";
import { GuidePanel } from "@/components/guides/guide-panel";
import { BossDropList } from "@/components/guides/boss-drop-list";
import { BossComments } from "@/components/loot/boss-comments";
import { Badge } from "@/components/ui/badge";
import { can } from "@/lib/auth/can";
import { pageView } from "@/lib/auth/view";
import { NoAccess } from "@/components/no-access";
import { compareText } from "@/lib/sort";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ zone: string; boss: string }>;
}): Promise<Metadata> {
  const { zone: zoneSlugParam, boss } = await params;
  const zone = zoneFromSlug(zoneSlugParam);
  const name = zone ? bossFromSlug(zone, boss) : undefined;
  return { title: name ?? "Boss guide" };
}

/**
 * One boss: what he drops, what the sheet says about it, and what anybody has
 * written down.
 *
 * The drop list is the reason this page is worth having. `/loot/plan` answers
 * "who should get this tonight" and is a working document read once a week;
 * this answers "what does he drop and what do we do about it", which is the
 * question a new officer or a raider planning a wishlist actually has.
 *
 * Three layers, and the page says which is which: the shared drop table, the
 * council's chain from the priority sheet, and the guild's own write-up. None
 * of them overwrites another.
 */
export default async function BossGuidePage({
  params,
}: {
  params: Promise<{ zone: string; boss: string }>;
}) {
  const access = await pageView("guild.view", { returnTo: "/guides" });
  if (!access.allowed) return <NoAccess reason={access.reason} />;

  const { zone: zoneParam, boss: bossParam } = await params;
  const zone = zoneFromSlug(zoneParam);
  if (!zone) notFound();
  const boss = bossFromSlug(zone, bossParam);
  if (!boss) notFound();

  const repo = await getRepo();
  const [guides, guild, drops, comments, permissions] = await Promise.all([
    repo.listGuides(),
    repo.getGuild(),
    repo.getDropTable(zone),
    repo.listBossComments(zone),
    guidePermissions(),
  ]);

  const key = bossKey(boss);
  const mine = drops
    .filter((d) => d.bossKey === key)
    .sort((a, b) => compareText(a.itemName, b.itemName));

  // The council's chain per drop, through the same lookup every other view
  // uses — a boss page quoting a different chain from the item page would be
  // worse than quoting none.
  const chains = new Map<string, string>();
  for (const drop of mine) {
    const rule = await repo.getItemPriorityRule(drop.itemId ?? 0, drop.itemName);
    if (rule?.chain) chains.set(drop.itemKey, rule.chain);
  }

  return (
    <div>
      <PageHeader
        title={boss}
        description={`${zone} — what he drops, and what this guild does about it.`}
      >
        <Badge variant="outline">
          {mine.length} drop{mine.length === 1 ? "" : "s"}
        </Badge>
        <Link
          href={`/guides/raids/${zoneSlug(zone)}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {zone}
        </Link>
      </PageHeader>

      <div className="space-y-4">
        <section className="rounded-xl border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">
            Drops
            <span className="ml-2 font-normal text-xs text-muted-foreground">
              from the shared drop table, with this guild&apos;s changes applied
            </span>
          </h2>
          <BossDropList zone={zone} drops={mine} chains={chains} />
        </section>

        <section className="rounded-xl border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">The fight</h2>
          <GuidePanel
            kind="raid"
            subject={zone}
            section={boss}
            label={boss}
            guides={findGuides(guides, "raid", zone, boss, guild.id)}
            permissions={permissions}
            hint="How the fight goes and what it asks of the raid. A few lines beats a transcription — link the guide you drew it from."
            placeholder={"Tank swaps on the debuff at 4 stacks.\nRanged spread for the whirlwind.\n…"}
          />
        </section>

        <section className="rounded-xl border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">
            Council notes
            <span className="ml-2 font-normal text-xs text-muted-foreground">
              the same notes that appear under him on the loot plan
            </span>
          </h2>
          <BossComments
            zone={zone}
            boss={boss}
            comments={comments.get(key) ?? []}
            canWrite={can(access.viewer, "comments.write")}
          />
        </section>
      </div>
    </div>
  );
}
