import { encounterSummary, type LoggedGearView } from "@/lib/analysis/logged-gear";
import { WornItemLink } from "@/components/gear-table";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Item } from "@/lib/types";

/**
 * Everything a raider wore per slot over the recent raid nights.
 *
 * Just slot and item: the enchant and the gems are carried into each item's
 * Wowhead tooltip (`item=…&ench=…&gems=…`), which renders the piece exactly as
 * it was worn — so hovering answers "what's on it" without a column for every
 * detail. Slots with more than one entry are the swaps: resist gear, a threat
 * trinket, a shield that only comes out on one boss.
 */
export function LoggedGearSummary({
  view,
  itemsById,
}: {
  view: LoggedGearView;
  itemsById: Map<number, Item>;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-24">Slot</TableHead>
          <TableHead>Item</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {view.slots.map((slot) => (
          <TableRow key={slot.index}>
            <TableCell className="align-top text-xs uppercase tracking-wide text-muted-foreground">
              {slot.label}
            </TableCell>
            <TableCell>
              <span className="flex flex-col gap-1">
                {slot.options.map((option) => (
                  <span key={option.itemId} className="flex items-center gap-2">
                    <WornItemLink
                      gearItem={{
                        id: option.itemId,
                        name: option.name,
                        icon: option.icon,
                        quality: option.quality,
                        enchant: option.enchantId,
                        gems: option.gems,
                      }}
                      cached={itemsById.get(option.itemId)}
                    />
                    <span
                      className="shrink-0 text-[11px] tabular-nums text-muted-foreground"
                      title={`${encounterSummary(option)} — last worn on ${option.lastSeen.encounterName}`}
                    >
                      {option.pulls}/{slot.slotPulls} pulls
                    </span>
                    {!option.current && (
                      <Badge
                        variant="muted"
                        className="shrink-0 px-1 py-0 text-[10px] font-normal"
                        title="Not what they wore on their most recent pull — a swap"
                      >
                        swap
                      </Badge>
                    )}
                  </span>
                ))}
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
