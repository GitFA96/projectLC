import { Check, Circle } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Badge } from "@/components/ui/badge";
import type { WishlistSlotState } from "@/lib/types";

export function AcquiredBadge({
  state,
  awardedAt,
}: {
  state: WishlistSlotState;
  awardedAt?: string;
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
      <Badge variant="success" className="gap-1">
        <Check className="h-3 w-3" />
        Awarded{awardedAt ? ` ${format(parseISO(awardedAt), "d MMM")}` : ""}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      <Circle className="h-2.5 w-2.5" /> Open
    </Badge>
  );
}
