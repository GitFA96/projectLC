import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ScrollText } from "lucide-react";
import { getRepo } from "@/lib/data/repo";
import { itemDisplayName } from "@/lib/items/item-data";
import { PageHeader } from "@/components/page-header";
import { LootView, type LootRow, type SessionOption } from "@/components/loot-view";

import { pageView } from "@/lib/auth/view";
import { NoAccess } from "@/components/no-access";
export const metadata: Metadata = { title: "Loot ledger" };

export default async function LootPage() {
  const access = await pageView("loot.view", { returnTo: "/loot" });
  if (!access.allowed) return <NoAccess reason={access.reason} />;

  const repo = await getRepo();
  const [awards, sessions, characters] = await Promise.all([
    repo.listLootAwards(),
    repo.listRaidSessions(),
    repo.listCharacters(),
  ]);

  const rows: LootRow[] = awards.map((a) => ({
    id: a.award.id,
    awardedAt: a.award.awardedAt,
    sessionId: a.session.id,
    sessionLabel: a.session.zones.join(" + "),
    phase: a.sessionPhase,
    item: {
      itemId: a.award.itemId,
      name: itemDisplayName(a.award.itemId, a.item?.name, a.award.itemName),
      quality: a.item?.quality,
      icon: a.item?.icon,
    },
    winnerName: a.character?.name ?? a.award.rawWinnerName,
    winnerClass: a.character?.class,
    winnerCharacterId: a.character?.id,
    winnerStatus: a.character ? ("roster" as const) : a.award.external ? ("external" as const) : ("unresolved" as const),
    offspec: a.award.offspec,
    matched: a.wishlist.matched,
    matchPhases: a.wishlist.phases,
    redeemsTo: a.wishlist.redeemsTo,
    note: a.award.note,
    decision: a.award.decision,
  }));

  const sessionOptions: SessionOption[] = sessions.map((s) => ({
    id: s.id,
    label: s.zones.join(" + "),
    date: s.date,
    count: rows.filter((r) => r.sessionId === s.id).length,
  }));

  return (
    <div>
      <PageHeader
        title="Loot ledger"
        description="Every Gargul-tracked award, matched against the winner's wishlists at view time."
      >
        <Link
          href="/loot/priority"
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
        >
          <ScrollText className="h-4 w-4" />
          Priority sheet
        </Link>
      </PageHeader>
      <Suspense>
        <LootView
          rows={rows}
          sessions={sessionOptions}
          characters={characters.map((c) => ({
            id: c.character.id,
            name: c.character.name,
            wowClass: c.character.class,
          }))}
        />
      </Suspense>
    </div>
  );
}
