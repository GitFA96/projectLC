import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function KpiCard({
  label,
  value,
  sub,
  className,
}: {
  label: string;
  value: string | number;
  sub?: string;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardContent className="p-4">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
        {sub && <p className={cn("mt-0.5 text-xs text-muted-foreground")}>{sub}</p>}
      </CardContent>
    </Card>
  );
}
