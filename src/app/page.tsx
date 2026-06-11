import Link from "next/link";
import { format, parseISO } from "date-fns";
import { getRepo } from "@/lib/data/repo";
import { KpiCard } from "@/components/kpi-card";
import { PageHeader } from "@/components/page-header";
import { ItemLink } from "@/components/item-link";
import { CharacterLink } from "@/components/class-badge";
import { FairnessBars } from "@/components/fairness-bars";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PHASES } from "@/lib/constants/wow";


export default async function DashboardPage() {
  const repo = await getRepo();
  const data = await repo.getDashboard();
  const phaseMeta = PHASES.find((p) => p.phase === data.guild.activePhase);

  return (
    <div className="space-y-5">
      <PageHeader
        title={data.guild.name}
        description={`${data.guild.realm} · ${data.guild.faction} · ${phaseMeta?.name} (${phaseMeta?.zones.join(", ")})`}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Raiders" value={data.rosterSize} sub="active roster" />
        <KpiCard
          label={`P${data.guild.activePhase} items awarded`}
          value={data.activePhaseAwards}
          sub="attributed by raid zone"
        />
        <KpiCard
          label={`Avg P${data.guild.activePhase} wishlist`}
          value={data.avgActivePhaseCompletion !== undefined ? `${data.avgActivePhaseCompletion}%` : "—"}
          sub="across imported wishlists"
        />
        <KpiCard
          label="Last raid"
          value={data.lastRaid ? format(parseISO(data.lastRaid.date), "d MMM") : "—"}
          sub={data.lastRaid?.zones.join(" + ")}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Recent raids</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {data.recentSessions.map(({ session, awardCount }) => (
              <Link
                key={session.id}
                href={`/loot?session=${encodeURIComponent(session.id)}`}
                className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{session.zones.join(" + ")}</span>
                  <span className="text-xs text-muted-foreground">
                    {format(parseISO(session.date), "EEE d MMM yyyy")}
                    {session.note ? ` · ${session.note}` : ""}
                  </span>
                </span>
                <Badge variant="secondary" className="shrink-0 tabular-nums">
                  {awardCount} items
                </Badge>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Most contested items</CardTitle>
            <p className="text-xs text-muted-foreground">Wishlisted by 2+ raiders, open demand first</p>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.contestedItems.map((c) => (
              <div key={c.itemId} className="flex items-center justify-between gap-2">
                <ItemLink
                  item={{ itemId: c.itemId, name: c.itemName, quality: c.item?.quality, icon: c.item?.icon }}
                  className="min-w-0"
                />
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {c.wishers.length} want · {c.openCount} open
                </span>
              </div>
            ))}
            {data.contestedItems.length === 0 && (
              <p className="text-sm text-muted-foreground">No contested wishlist items.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Loot distribution</CardTitle>
            <p className="text-xs text-muted-foreground">
              On-spec awards per raider, all raids tracked (off-spec faded)
            </p>
          </CardHeader>
          <CardContent>
            <FairnessBars
              entries={data.fairness.map((f) => ({
                name: f.character.name,
                wowClass: f.character.class,
                onSpec: f.onSpec,
                offSpec: f.offSpec,
              }))}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Where to start</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-3">
          <p>
            <CharacterLink name="Thrainn" wowClass="Warrior" /> — full showcase: current gear, P1+P2
            wishlists, stat deltas and loot history.
          </p>
          <p>
            <ItemLink
              item={{ itemId: 28830, name: "Dragonspine Trophy", quality: "epic", icon: "inv_misc_bone_10" }}
              showIcon={false}
            />{" "}
            — contention view: who wants it, who got it.
          </p>
          <p>
            <Link href="/loot" className="font-medium text-foreground hover:underline">
              Loot ledger
            </Link>{" "}
            — every award with wishlist-match status, filterable.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
