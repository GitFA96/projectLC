import { Shield, Cross, Swords, Crosshair } from "lucide-react";
import type { Role } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const ROLE_META: Record<Role, { icon: typeof Shield; short: string }> = {
  Tank: { icon: Shield, short: "Tank" },
  Healer: { icon: Cross, short: "Healer" },
  "Melee DPS": { icon: Swords, short: "Melee" },
  "Ranged DPS": { icon: Crosshair, short: "Ranged" },
};

export function RoleBadge({ role, className }: { role: Role; className?: string }) {
  const { icon: Icon, short } = ROLE_META[role];
  return (
    <Badge variant="muted" className={cn("gap-1", className)}>
      <Icon className="h-3 w-3" />
      {short}
    </Badge>
  );
}
