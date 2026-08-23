import Link from "next/link";
import { CharacterLink } from "@/components/class-badge";
import { ItemIcon } from "@/components/item-icon";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { rankLabel } from "@/lib/analysis/wishlist-alternatives";
import type { LootPlan, LootPlanItem } from "@/lib/analysis/loot-plan";
import { BossComments } from "@/components/loot/boss-comments";
import { DropOverrides, HideDropButton } from "@/components/loot/drop-overrides";
import type { BossComment } from "@/lib/types";
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
export function LootPlanView({
  plan,
  comments,
  canComment,
  canCurate,
}: {
  plan: LootPlan;
  /** The council's notes for this zone, by boss key. */
  comments: Map<string, BossComment[]>;
  canComment: boolean;
  /** May this viewer change what the guild counts as dropping here? */
  canCurate: boolean;
}) {
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
            and the drops this zone has actually produced appear here. A{" "}
            <Link href="/loot/priority" className="font-medium text-foreground underline-offset-2 hover:underline">
              priority sheet
            </Link>{" "}
            written boss by boss fills it too: its headings say where each item drops, and the
            item backfill on the import page reads them.
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
        {plan.unmappedCount > 0 && (
          <Stat value={plan.unmappedCount} label="bosses with nothing mapped" />
        )}
      </div>

      {plan.bosses.map((boss) => (
        <Card key={boss.key || "unattributed"} id={boss.key || undefined}>
          <CardHeader className="space-y-1">
            <CardTitle className="flex flex-wrap items-baseline gap-2 text-base">
              {boss.boss || "Drop source not recorded"}
              <span className="text-xs font-normal text-muted-foreground">
                {boss.unmapped
                  ? "no drops mapped yet"
                  : boss.contestedCount > 0
                    ? `${boss.contestedCount} contested of ${boss.items.length}`
                    : `${boss.items.length} item${boss.items.length === 1 ? "" : "s"}, none contested`}
              </span>
              {!boss.unmapped && boss.chainCount < boss.items.length && (
                <Badge
                  variant="muted"
                  className="font-normal"
                  title="Drops the priority sheet writes no chain for — the council decides these live unless the sheet gains a line"
                >
                  {boss.chainCount}/{boss.items.length} on the sheet
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {boss.unmapped ? (
              <p className="text-sm text-muted-foreground">
                Nothing in the drop table or the priority sheet names a drop from him yet. He is
                listed because the raid meets him — an empty card is a gap to fill, not a boss
                without loot.
              </p>
            ) : (
              boss.items.map((item) => (
                <PlanRow
                  key={item.itemId ?? `sheet:${item.name}`}
                  item={item}
                  zone={plan.zone}
                  boss={boss.boss}
                  canCurate={canCurate}
                />
              ))
            )}
            <DropOverrides
              zone={plan.zone}
              boss={boss.boss}
              hidden={boss.hidden}
              canCurate={canCurate}
            />
            <BossComments
              zone={plan.zone}
              boss={boss.boss}
              comments={comments.get(boss.key) ?? []}
              canWrite={canComment}
            />
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

function PlanRow({
  item,
  zone,
  boss,
  canCurate,
}: {
  item: LootPlanItem;
  zone: string;
  boss: string;
  canCurate: boolean;
}) {
  const quality = item.quality ?? "common";
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b py-2 last:border-b-0">
      <ItemIcon icon={item.icon} quality={quality} size={24} />
      {item.itemId === undefined ? (
        // No id anywhere, so there is no item page to open and no tooltip to
        // hover. Rendered as plain text rather than a dead link — see the
        // sheet-only note below for what an officer can do about it.
        <span className="min-w-0 font-medium" style={{ color: QUALITY_TEXT_COLORS[quality] }}>
          {item.name}
        </span>
      ) : (
        <Link
          href={`/items/${item.itemId}`}
          className="min-w-0 font-medium hover:underline"
          style={{ color: QUALITY_TEXT_COLORS[quality] }}
        >
          {item.name}
        </Link>
      )}

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
          ) : item.sheetOnly ? (
            <>
              On the sheet, not in the item cache
              {item.slotLabel ? ` (${item.slotLabel})` : ""} — nobody has wishlisted or won it, so
              there is no id to hang an icon or a tooltip on
            </>
          ) : (
            <>Nobody lists it — decide the offspec rule now, not at 22:40</>
          )}
        </span>
      )}

      <span className="flex shrink-0 flex-wrap items-center gap-1.5">
        {item.guildAdded && (
          <Badge
            variant="secondary"
            className="font-normal"
            title="Added by this guild — it is not on the shared drop table"
          >
            ours
          </Badge>
        )}
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
        {canCurate && (
          <HideDropButton zone={zone} boss={boss} itemName={item.name} itemId={item.itemId} />
        )}
      </span>
    </div>
  );
}
