"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * A card whose body folds away behind its header — used for dense reference
 * tables that shouldn't dominate the page (the full uptime table lives under
 * the boss-by-boss view). Server-rendered children pass straight through;
 * only the open/closed bit lives here.
 */
export function CollapsibleCard({
  title,
  description,
  defaultOpen = false,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <Card>
      <CardHeader
        className="cursor-pointer select-none"
        onClick={() => setOpen((o) => !o)}
        role="button"
        aria-expanded={open}
      >
        <CardTitle className="flex items-center gap-1.5">
          <ChevronRight
            className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-90")}
            aria-hidden
          />
          {title}
        </CardTitle>
        {/* A div, not a p: `description` is typed ReactNode and callers pass
            real markup into it — the Development card puts its trend lines here
            so they stay readable while the card is folded. A <p> silently makes
            that invalid HTML (no <p> or <div> may nest inside one) and the only
            symptom is a hydration error pointing at the caller, not at here. */}
        {description && <div className="text-xs text-muted-foreground">{description}</div>}
      </CardHeader>
      {open && <CardContent>{children}</CardContent>}
    </Card>
  );
}
