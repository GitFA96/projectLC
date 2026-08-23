import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ItemLink } from "@/components/item-link";
import { wowheadItemUrl } from "@/lib/constants/wow";
import type { MergedDrop } from "@/lib/loot/drop-table";

/**
 * One boss's drops, as the guide reads them.
 *
 * Deliberately quieter than the loot plan's version: no contenders, no ranking,
 * no "read this out before the pull". This page answers "what does he drop and
 * what is our rule", which is what somebody planning a wishlist or learning the
 * raid needs — the plan answers "who gets it tonight" and is a different job.
 *
 * Rendering goes through `ItemLink` rather than hand-rolled markup, which is
 * what gives every row the icon, the quality colour and the Wowhead hover that
 * the rest of the app has. Beside it sits an **outbound** link to Wowhead:
 * the hover is a summary, and somebody reading a boss page to plan a wishlist
 * wants the real page — the comparisons, the drop rate, the comments.
 *
 * Three provenances stay visible because they mean different things: a drop the
 * whole deployment shares, one this guild added, and one written under a name
 * the item cache disagrees with.
 */
export function BossDropList({
  zone,
  drops,
  chains,
}: {
  zone: string;
  drops: MergedDrop[];
  /** The council's chain per drop, keyed by `itemKey`. */
  chains: Map<string, string>;
}) {
  if (drops.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing mapped to him yet. The drop table is shared across the deployment — whoever runs it
        fills it in, and this guild can add anything they see here that it misses.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {drops.map((drop) => (
        <div
          key={drop.itemKey}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b py-1.5 text-sm last:border-b-0"
        >
          <span className="min-w-0 flex-1">
            {drop.itemId === undefined ? (
              // No id, so there is no item page and no tooltip to hang on it.
              // Rendered as plain text rather than a dead link.
              <span className="font-medium">{drop.itemName}</span>
            ) : (
              <ItemLink
                item={{
                  itemId: drop.itemId,
                  // The drop table's name, not the cache's: where the two differ
                  // it is because the table is carrying a distinction the item
                  // name cannot — "(Main Hand)" on a Warglaive.
                  name: drop.itemName,
                  quality: drop.quality,
                  icon: drop.icon,
                }}
              />
            )}
          </span>

          {drop.slotLabel && (
            <span className="shrink-0 text-xs text-muted-foreground">{drop.slotLabel}</span>
          )}

          {chains.get(drop.itemKey) ? (
            <Badge variant="muted" className="font-normal" title="The council's chain for this item">
              {chains.get(drop.itemKey)}
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="font-normal text-muted-foreground"
              title="No priority sheet row covers this drop — the council decides it live"
            >
              no chain
            </Badge>
          )}

          {drop.origin === "guild" && (
            <Badge
              variant="secondary"
              className="font-normal"
              title="Added by this guild — it is not on the shared drop table"
            >
              ours
            </Badge>
          )}
          {drop.writtenName && (
            <span
              className="shrink-0 text-xs text-muted-foreground"
              title={`The drop table has it as "${drop.writtenName}"`}
            >
              written differently
            </span>
          )}

          {drop.itemId !== undefined && (
            <a
              href={wowheadItemUrl(drop.itemId)}
              target="_blank"
              rel="noreferrer noopener"
              title={`Open ${drop.itemName} on Wowhead`}
              aria-label={`Open ${drop.itemName} on Wowhead`}
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      ))}
      <p className="pt-1 text-xs text-muted-foreground">
        Sourced from the shared drop table. To change what this guild counts as dropping here, use
        the controls on the{" "}
        <Link href={`/loot/plan?zone=${encodeURIComponent(zone)}`} className="underline underline-offset-2">
          loot plan
        </Link>
        .
      </p>
    </div>
  );
}
