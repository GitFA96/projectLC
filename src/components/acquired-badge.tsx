import { Check, Circle } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Badge } from "@/components/ui/badge";
import type { WishlistSlotState } from "@/lib/types";

export function AcquiredBadge({
  state,
  awardedAt,
  awardedVia,
}: {
  state: WishlistSlotState;
  awardedAt?: string;
  /**
   * The armor token this slot was actually won as. The slot is served either
   * way — the vendor trip is the raider's errand — but the ledger says the
   * token's name, so the badge has to be able to say it too.
   */
  awardedVia?: { itemId: number; itemName: string };
}) {
  if (state === "equipped") {
    return (
      <Badge variant="secondary" className="gap-1">
        <Check className="h-3 w-3" /> Equipped
      </Badge>
    );
  }
  if (state === "awarded") {
    return (
      <Badge
        variant="success"
        className="gap-1"
        title={awardedVia ? `Won as ${awardedVia.itemName}` : undefined}
      >
        <Check className="h-3 w-3" />
        Awarded{awardedAt ? ` ${format(parseISO(awardedAt), "d MMM")}` : ""}
        {awardedVia ? " (token)" : ""}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      <Circle className="h-2.5 w-2.5" /> Open
    </Badge>
  );
}
