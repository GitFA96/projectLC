import type { Metadata } from "next";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { Download, MessageSquareWarning } from "lucide-react";
import { getRepo } from "@/lib/data/repo";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Admin" };

/**
 * The landing page for /admin.
 *
 * It exists because the URL did not: the nav points its Admin tab straight at
 * Import, so a typed or bookmarked /admin used to 404 with nothing to suggest
 * where the pages had gone.
 *
 * Each card carries the one number that decides whether you need to open it —
 * how long since the last import, how many items the cache still can't name,
 * how many reports nobody has looked at. A landing page that only lists links
 * makes you visit both to find out there was nothing to do.
 */
export default async function AdminPage() {
  const repo = await getRepo();
  const [reports, feedback, unresolvedItems, unnamedEnchants] = await Promise.all([
    repo.listWclReports(),
    repo.listFeedback(),
    repo.listUnresolvedItemIds(),
    repo.listUnnamedEnchantIds(),
  ]);

  const latest = [...reports].sort((a, b) =>
    b.report.startTime.localeCompare(a.report.startTime),
  )[0];
  const openReports = feedback.filter((r) => r.status === "open").length;
  const gaps = unresolvedItems.length + unnamedEnchants.length;

  return (
    <div>
      <PageHeader
        title="Admin"
        description="Getting data in, and the reports about what looked wrong once it was."
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <AdminCard
          href="/admin/import"
          icon={<Download className="h-4 w-4" />}
          title="Import"
          description="Warcraft Logs reports, SixtyUpgrades wishlists, Gargul loot exports, and the item-name cache."
          headline={
            latest
              ? `${reports.length} report${reports.length === 1 ? "" : "s"}`
              : "Nothing imported yet"
          }
          sub={
            latest
              ? `latest ${format(parseISO(latest.report.startTime), "d MMM yyyy")} — ${latest.report.title}`
              : "start with a Warcraft Logs report"
          }
          note={
            gaps > 0
              ? `${gaps} id${gaps === 1 ? "" : "s"} the cache can't name or hasn't confirmed against Wowhead`
              : undefined
          }
        />

        <AdminCard
          href="/admin/feedback"
          icon={<MessageSquareWarning className="h-4 w-4" />}
          title="Feedback"
          description="Bug reports filed from the widget in the corner of every page, with the route and context they were sent from."
          headline={
            feedback.length === 0
              ? "Nothing filed"
              : `${openReports} open`
          }
          sub={
            feedback.length === 0
              ? "the widget is on every page"
              : `of ${feedback.length} total`
          }
          note={openReports > 0 ? "somebody hit something that looked wrong" : undefined}
        />
      </div>
    </div>
  );
}

function AdminCard({
  href,
  icon,
  title,
  description,
  headline,
  sub,
  note,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  headline: string;
  sub: string;
  note?: string;
}) {
  return (
    <Card className="transition-colors hover:border-foreground/20">
      <CardHeader className="space-y-1.5">
        <CardTitle className="flex items-center gap-2">
          {icon}
          <Link href={href} className="hover:underline">
            {title}
          </Link>
        </CardTitle>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className="text-2xl font-semibold tabular-nums tracking-tight">{headline}</p>
        <p className="text-xs text-muted-foreground">{sub}</p>
        {note && <p className="pt-1 text-xs text-warn-ink">{note}</p>}
      </CardContent>
    </Card>
  );
}
