import type { Metadata } from "next";
import Link from "next/link";
import { getRepo } from "@/lib/data/repo";
import { WOW_CLASSES, CLASS_TEXT_COLORS } from "@/lib/constants/wow";
import { classSlug, guideCoverage } from "@/lib/guides";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Class guides" };

/**
 * What the guild expects from each class — its own words, with its sources.
 *
 * This exists because the app deliberately owns no opinion about which flask a
 * Fury warrior should drink. Once the officers write it down here, the gear and
 * consumable audits have something to measure against that the guild can
 * defend, rather than a list somebody hard-coded.
 */
export default async function GuidesPage() {
  const repo = await getRepo();
  const guides = await repo.listClassGuides();

  return (
    <div>
      <PageHeader
        title="Class guides"
        description="What each class and spec should be bringing — the guild's summary, with the pages it was drawn from. Written by officers, not shipped by the app."
      >
        <Badge variant="outline">
          {guides.length} {guides.length === 1 ? "guide" : "guides"} written
        </Badge>
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {WOW_CLASSES.map((wowClass) => {
          const { written, total } = guideCoverage(guides, wowClass);
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

      <p className="mt-5 max-w-3xl text-xs text-muted-foreground">
        A guide is a <strong>summary with a link</strong>, not a copy. Pasting someone else&apos;s
        page in full goes stale without anyone noticing; a few lines an officer wrote get corrected
        the moment they stop being true, and the source stays one click away for anyone who wants
        the detail.
      </p>
    </div>
  );
}
