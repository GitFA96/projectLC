import type { Metadata } from "next";
import { getRepo } from "@/lib/data/repo";
import { PageHeader } from "@/components/page-header";
import { ItemsView, type ItemDemandRow } from "@/components/items-view";
import { SLOT_LABELS } from "@/lib/constants/wow";

import { pageView } from "@/lib/auth/view";
import { NoAccess } from "@/components/no-access";
export const metadata: Metadata = { title: "Items" };

export default async function ItemsPage() {
  const access = await pageView("loot.view", { returnTo: "/items" });
  if (!access.allowed) return <NoAccess reason={access.reason} />;

  const repo = await getRepo();
  const demand = await repo.listItemDemand();

  const rows: ItemDemandRow[] = demand.map((d) => ({
    itemId: d.itemId,
    name: d.name,
    quality: d.quality,
    icon: d.icon,
    slotLabel: d.slot ? SLOT_LABELS[d.slot] : undefined,
    source: d.source ? [d.source.boss, d.source.zone].filter(Boolean).join(" — ") : undefined,
    phase: d.phase,
    wisherCount: d.wisherCount,
    openCount: d.openCount,
    awardCount: d.awardCount,
    lastAwardedAt: d.lastAwardedAt,
  }));

  return (
    <div>
      <PageHeader
        title="Items"
        description="Everything the tracker knows about — wishlist demand, open contention, drop history. When something drops, look it up here."
      />
      <ItemsView rows={rows} />
    </div>
  );
}
