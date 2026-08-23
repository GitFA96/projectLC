import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getRepo } from "@/lib/data/repo";
import { PHASES, TBC_RAIDS, TRASH_BOSS } from "@/lib/constants/wow";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { DropTableEditor } from "@/components/service/drop-table-editor";
import { pageView } from "@/lib/auth/view";
import { NoAccess } from "@/components/no-access";

export const metadata: Metadata = { title: "Drop table" };

/**
 * What each boss drops — the foundational layer, for every guild on this
 * deployment.
 *
 * This belongs on `/service` and not on a guild's own pages because of what the
 * data is rather than who happens to edit it. Which items Supremus drops is a
 * fact about the game, identical on every realm; who should get one is a
 * council's judgement and lives with the council. Welding the two together is
 * what made correcting a misspelled item name a code change and a deploy.
 *
 * A guild that disagrees does not edit this. They add or hide drops in their own
 * overlay, which changes what they read and nothing that anybody else reads.
 */
export default async function DropTablePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const access = await pageView("app-admin", { returnTo: "/service/drops" });
  if (!access.allowed) return <NoAccess reason={access.reason} />;

  const sp = await searchParams;
  const zones = PHASES.flatMap((p) => p.zones);
  const requested = Array.isArray(sp.zone) ? sp.zone[0] : sp.zone;
  const zone = zones.find((z) => z === requested) ?? zones[0];

  const repo = await getRepo();
  const [drops, all] = await Promise.all([
    repo.getFoundationalDropTable(zone),
    repo.listFoundationalDrops(),
  ]);

  // Trash first, then the raid table's own order — the order the raid meets
  // them, which is the order the loot plan this feeds is read in.
  const raid = TBC_RAIDS.find((r) => r.name === zone);
  const bosses = [TRASH_BOSS, ...(raid?.bosses ?? [])];

  return (
    <div>
      <PageHeader
        title="Drop table"
        description="What each boss drops, shared by every guild on this deployment. A fact about the game — priorities and rulings belong to the councils and are not editable here."
      >
        <Badge variant="outline">{all.length} drops recorded</Badge>
        <Link
          href="/service"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Service
        </Link>
      </PageHeader>

      <nav className="mb-4 flex flex-wrap items-center gap-1.5" aria-label="Zone">
        {zones.map((z) => {
          const count = all.filter((d) => d.zone === z).length;
          return (
            <Link
              key={z}
              href={`/service/drops?zone=${encodeURIComponent(z)}`}
              className={
                z === zone
                  ? "rounded-md bg-accent px-2.5 py-1 text-sm font-medium"
                  : "rounded-md px-2.5 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              }
            >
              {z}
              <span className="ml-1.5 text-xs tabular-nums opacity-70">{count}</span>
            </Link>
          );
        })}
      </nav>

      <DropTableEditor zone={zone} bosses={bosses} drops={drops} />
    </div>
  );
}
