import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getRepo } from "@/lib/data/repo";
import { CLASS_TEXT_COLORS } from "@/lib/constants/wow";
import { classFromSlug, findGuide, guideSlots } from "@/lib/guides";
import { PageHeader } from "@/components/page-header";
import { GuideEditor } from "@/components/guides/guide-editor";
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
  const guides = await repo.listClassGuides();

  return (
    <div>
      <PageHeader
        title={<span className={CLASS_TEXT_COLORS[wowClass]}>{wowClass}</span>}
        description="What this guild expects, in its own words. Each section is editable, and every summary should name where it came from."
      >
        <Link
          href="/guides"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          All classes
        </Link>
      </PageHeader>

      <div className="space-y-4">
        {guideSlots(wowClass).map(({ spec, label }) => (
          <section
            key={spec || "class"}
            className={cn("rounded-xl border bg-card p-4", spec === "" && "border-primary/30")}
          >
            <h2 className="mb-2 text-sm font-semibold">
              {label}
              {spec === "" && (
                <span className="ml-2 font-normal text-xs text-muted-foreground">
                  applies to every {wowClass}
                </span>
              )}
            </h2>
            <GuideEditor
              wowClass={wowClass}
              spec={spec}
              label={spec ? `${spec} ${wowClass}` : wowClass}
              guide={findGuide(guides, wowClass, spec)}
            />
          </section>
        ))}
      </div>
    </div>
  );
}
