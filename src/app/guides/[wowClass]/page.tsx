import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getRepo } from "@/lib/data/repo";
import { CLASS_TEXT_COLORS } from "@/lib/constants/wow";
import { classFromSlug, findGuides, guideSlots } from "@/lib/guides";
import { PageHeader } from "@/components/page-header";
import { GuidePanel } from "@/components/guides/guide-panel";
import { guidePermissions } from "@/app/guides/actions";
import { cn } from "@/lib/utils";

import { pageView } from "@/lib/auth/view";
import { NoAccess } from "@/components/no-access";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ wowClass: string }>;
}): Promise<Metadata> {
  const { wowClass } = await params;
  const resolved = classFromSlug(wowClass);
  return { title: resolved ? `${resolved} guide` : "Class guide" };
}

/**
 * One class: what every spec shares, then each spec's own.
 *
 * The class-level guide comes first because most of what a guild expects is
 * shared — the flask, the food, showing up enchanted — and repeating it under
 * three specs is how three copies drift apart.
 */
export default async function ClassGuidePage({
  params,
}: {
  params: Promise<{ wowClass: string }>;
}) {
  const access = await pageView("guild.view", { returnTo: "/guides" });
  if (!access.allowed) return <NoAccess reason={access.reason} />;

  const { wowClass: slug } = await params;
  const wowClass = classFromSlug(slug);
  if (!wowClass) notFound();

  const repo = await getRepo();
  const [guides, guild, permissions] = await Promise.all([
    repo.listGuides(),
    repo.getGuild(),
    guidePermissions(),
  ]);

  return (
    <div>
      <PageHeader
        title={<span className={CLASS_TEXT_COLORS[wowClass]}>{wowClass}</span>}
        description="What this guild expects, in its own words, over whatever shared baseline exists. Every summary should name where it came from."
      >
        <Link
          href="/guides"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          All guides
        </Link>
      </PageHeader>

      <div className="space-y-4">
        {guideSlots(wowClass).map(({ section, label }) => (
          <section
            key={section || "class"}
            className={cn("rounded-xl border bg-card p-4", section === "" && "border-primary/30")}
          >
            <h2 className="mb-2 text-sm font-semibold">
              {label}
              {section === "" && (
                <span className="ml-2 font-normal text-xs text-muted-foreground">
                  applies to every {wowClass}
                </span>
              )}
            </h2>
            <GuidePanel
              kind="class"
              subject={wowClass}
              section={section}
              label={section ? `${section} ${wowClass}` : wowClass}
              guides={findGuides(guides, "class", wowClass, section, guild.id)}
              permissions={permissions}
              hint="Consumables, enchants, gems, cooldown use — what this guild expects. A few lines beats a transcription."
              placeholder={"Flask of Relentless Assault.\nHaste potion on cooldown with Bloodlust.\n…"}
            />
          </section>
        ))}
      </div>
    </div>
  );
}
