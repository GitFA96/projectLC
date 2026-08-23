import type { Metadata } from "next";
import Link from "next/link";
import { getRepo } from "@/lib/data/repo";
import { CLASS_TEXT_COLORS, TBC_RAIDS, WOW_CLASSES } from "@/lib/constants/wow";
import { classSlug, guideCoverage, guideSlots, raidSections, zoneSlug } from "@/lib/guides";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { pageView } from "@/lib/auth/view";
import { NoAccess } from "@/components/no-access";
export const metadata: Metadata = { title: "Guides" };

/**
 * What the guild expects, in two halves.
 *
 * **Classes** are what a raider should be bringing; **raids** are what the
 * night in front of them contains. They sit together because they answer the
 * same kind of question — "what should I know before we pull" — and because the
 * audits measure against both.
 *
 * Each is written twice over: whoever runs the service writes a baseline that
 * every guild can read as a template, and the guild writes its own beside it.
 * Neither replaces the other.
 */
export default async function GuidesPage() {
  const access = await pageView("guild.view", { returnTo: "/guides" });
  if (!access.allowed) return <NoAccess reason={access.reason} />;

  const repo = await getRepo();
  const [guides, guild] = await Promise.all([repo.listGuides(), repo.getGuild()]);

  return (
    <div>
      <PageHeader
        title="Guides"
        description="What each class should be bringing, and what each boss drops — the guild's own words over a shared baseline. Written by people, not shipped by the app."
      >
        <Badge variant="outline">{guides.length} written</Badge>
      </PageHeader>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold">Raids</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TBC_RAIDS.map((raid) => {
            const sections = raidSections(raid.name);
            const { written, total } = guideCoverage(guides, "raid", raid.name, sections, guild.id);
            return (
              <Link
                key={raid.name}
                href={`/guides/raids/${zoneSlug(raid.name)}`}
                className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 transition-colors hover:bg-accent"
              >
                <span className="font-medium">{raid.name}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {written === 0 ? `${total} bosses` : `${written}/${total}`}
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Classes</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {WOW_CLASSES.map((wowClass) => {
            const sections = guideSlots(wowClass).map((s) => s.section);
            const { written, total } = guideCoverage(guides, "class", wowClass, sections, guild.id);
            return (
              <Link
                key={wowClass}
                href={`/guides/${classSlug(wowClass)}`}
                className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 transition-colors hover:bg-accent"
              >
                <span className={cn("font-medium", CLASS_TEXT_COLORS[wowClass])}>{wowClass}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {written === 0 ? "nothing written" : `${written}/${total}`}
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <p className="mt-5 max-w-3xl text-xs text-muted-foreground">
        A guide is a <strong>summary with a link</strong>, not a copy. Pasting someone else&apos;s
        page in full goes stale without anyone noticing; a few lines somebody wrote get corrected
        the moment they stop being true, and the source stays one click away for anyone who wants
        the detail.
      </p>
    </div>
  );
}
