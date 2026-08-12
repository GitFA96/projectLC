import Link from "next/link";
import { CharacterLink } from "@/components/class-badge";
import { ItemIcon } from "@/components/item-icon";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { rankLabel } from "@/lib/analysis/wishlist-alternatives";
import type { LootPlan, LootPlanItem } from "@/lib/analysis/loot-plan";
import { QUALITY_TEXT_COLORS, type WowClass } from "@/lib/constants/wow";

/**
 * The plan, read the way it gets used: down the list, boss by boss, stopping at
 * the contested rows.
 *
 * Served and unwanted items are folded away rather than dropped. "Nobody wants
 * this" is worth deciding once, in advance, instead of arguing about the
 * offspec rule with a raid standing still — and "everyone who wants it has it"
 * is the answer to "why didn't we ask about the belt", weeks later.
 */
export function LootPlanView({ plan }: { plan: LootPlan }) {
  if (plan.bosses.length === 0) {
    return (
      <Card>
        <CardContent className="p-5">
          <p className="text-sm text-muted-foreground">
            Nothing cached for {plan.zone} yet. The plan is built from the item cache, so it fills
            in as loot is imported —{" "}
            <Link href="/guild/import" className="font-medium text-foreground underline-offset-2 hover:underline">
              import a Gargul export or a log
            </Link>{" "}
            and the drops this zone has actually produced appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 text-sm">
        <Stat value={plan.contestedCount} label="contested" tone="warn" />
        <Stat value={plan.servedCount} label="already served" />
        <Stat value={plan.unwantedCount} label="nobody lists" />
      </div>

      {plan.bosses.map((boss) => (
        <Card key={boss.boss || "unattributed"}>
          <CardHeader className="space-y-1">
            <CardTitle className="flex flex-wrap items-baseline gap-2 text-base">
              {boss.boss || "Drop source not recorded"}
              <span className="text-xs font-normal text-muted-foreground">
                {boss.contestedCount > 0
                  ? `${boss.contestedCount} contested of ${boss.items.length}`
                  : `${boss.items.length} item${boss.items.length === 1 ? "" : "s"}, none contested`}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {boss.items.map((item) => (
              <PlanRow key={item.itemId} item={item} />
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function Stat({ value, label, tone }: { value: number; label: string; tone?: "warn" }) {
  return (
    <span className="flex items-baseline gap-1.5 rounded-lg border px-2.5 py-1">
      <span
        className={
          tone === "warn"
            ? "text-lg font-semibold tabular-nums text-warn-ink"
            : "text-lg font-semibold tabular-nums"
        }
      >
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </span>
  );
}

function PlanRow({ item }: { item: LootPlanItem }) {
  const quality = item.quality ?? "common";
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b py-2 last:border-b-0">
      <ItemIcon icon={item.icon} quality={quality} size={24} />
      <Link
        href={`/items/${item.itemId}`}
        className="min-w-0 font-medium hover:underline"
        style={{ color: QUALITY_TEXT_COLORS[quality] }}
      >
        {item.name}
      </Link>

      {item.status === "contested" ? (
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
          {item.contenders.slice(0, 4).map((c, i) => (
            <span key={c.characterId} className="flex items-center gap-1 text-sm">
              <span className="tabular-nums text-muted-foreground">{i + 1}.</span>
              <CharacterLink name={c.name} wowClass={c.wowClass as WowClass} className="text-sm" />
              {c.listRank > 0 && (
                <Badge variant="warning" className="font-normal" title="Not their first pick for this slot">
                  {rankLabel(c.listRank)}
                </Badge>
              )}
            </span>
          ))}
          {item.contenders.length > 4 && (
            <span className="text-xs text-muted-foreground">
              +{item.contenders.length - 4} more
            </span>
          )}
        </span>
      ) : (
        <span className="flex-1 text-sm text-muted-foreground">
          {item.status === "served" ? (
            <>
              Everyone who lists it already has it{" "}
              <span className="text-muted-foreground/70">({item.wisherCount} wisher{item.wisherCount === 1 ? "" : "s"})</span>
            </>
          ) : (
            <>Nobody lists it — decide the offspec rule now, not at 22:40</>
          )}
        </span>
      )}

      <span className="flex shrink-0 flex-wrap items-center gap-1.5">
        {item.chain && (
          <Badge variant="muted" className="font-normal" title="The council's chain for this item">
            {item.chain}
          </Badge>
        )}
        {item.altWishers.length > 0 && (
          <Badge
            variant="muted"
            className="font-normal"
            title={`Listed by ${item.altWishers.join(", ")} — alts, so they don't contend`}
          >
            {item.altWishers.length} alt{item.altWishers.length === 1 ? "" : "s"}
          </Badge>
        )}
      </span>
    </div>
  );
}
