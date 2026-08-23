import type { Metadata } from "next";
import Link from "next/link";
import { getRepo } from "@/lib/data/repo";
import { PHASES, TBC_RAIDS } from "@/lib/constants/wow";
import { guideCoverage, raidSections, zoneSlug } from "@/lib/guides";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { pageView } from "@/lib/auth/view";
import { NoAccess } from "@/components/no-access";

export const metadata: Metadata = { title: "Raid guides" };

/**
 * Every raid, grouped by the phase it belongs to.
 *
 * Grouped rather than listed flat because that is how a guild thinks about
 * them — what we are on, what is behind us, what is next — and because the
 * counts mean different things in each: an empty drop table for the current
 * tier is a gap to fill tonight, and for a future one it is simply not yet.
 */
export default async function RaidGuidesPage() {
  const access = await pageView("guild.view", { returnTo: "/guides" });
  if (!access.allowed) return <NoAccess reason={access.reason} />;

  const repo = await getRepo();
  const [guides, guild] = await Promise.all([repo.listGuides(), repo.getGuild()]);

  // One read per raid, so a zone with no drop table shows a zero rather than
  // being quietly indistinguishable from one nobody has raided.
  const dropCounts = new Map<string, number>();
  await Promise.all(
    TBC_RAIDS.map(async (raid) => {
      dropCounts.set(raid.name, (await repo.getDropTable(raid.name)).length);
    }),
  );

  return (
    <div>
      <PageHeader
        title="Raid guides"
        description="What each boss drops and what this guild does about it. The drop table is shared across the deployment; everything written beside it is yours."
      >
        <Link
          href="/guides"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          All guides
        </Link>
      </PageHeader>

      <div className="space-y-5">
        {PHASES.map((phase) => {
          const raids = TBC_RAIDS.filter((r) => phase.zones.includes(r.name));
          if (raids.length === 0) return null;
          return (
            <section key={phase.phase}>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                {phase.name}
                {phase.phase === guild.activePhase && (
                  <Badge variant="secondary" className="font-normal">
                    active
                  </Badge>
                )}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {raids.map((raid) => {
                  const sections = raidSections(raid.name);
                  const { written, total } = guideCoverage(
                    guides,
                    "raid",
                    raid.name,
                    sections,
                    guild.id,
                  );
                  const drops = dropCounts.get(raid.name) ?? 0;
                  return (
                    <Link
                      key={raid.name}
                      href={`/guides/raids/${zoneSlug(raid.name)}`}
                      className="rounded-xl border bg-card px-4 py-3 transition-colors hover:bg-accent"
                    >
                      <div className="font-medium">{raid.name}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {drops === 0 ? "no drops mapped" : `${drops} drops`} ·{" "}
                        {written === 0 ? `${total} bosses` : `${written}/${total} written`}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
