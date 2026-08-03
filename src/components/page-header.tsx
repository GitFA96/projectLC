import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    // The actions are a fixed right-hand column rather than another flex item:
    // a profile's badge row grows with every off-spec, alt link and warning,
    // and with plain flex-wrap that growth eventually shoves the buttons onto
    // their own line. `min-w-0` lets the badges wrap inside their own column
    // instead, so the buttons stay put wherever the header is used.
    <div
      className={cn(
        "mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{children}</div>
      )}
    </div>
  );
}
