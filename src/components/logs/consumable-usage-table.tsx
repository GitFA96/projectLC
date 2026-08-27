"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ConsumableTypeRow } from "@/lib/types";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/** One provider chip: a class-uncolored name that deep-links when matched. */
function Provider({ name, slug, count }: { name: string; slug?: string; count: number }) {
  const label = (
    <>
      {name}
      {count > 1 && <span className="ml-0.5 text-muted-foreground">×{count}</span>}
    </>
  );
  return (
    <span className="inline-flex whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-xs">
      {slug ? (
        <Link
          href={`/characters/${encodeURIComponent(slug)}/performance`}
          className="font-medium hover:underline"
        >
          {label}
        </Link>
      ) : (
        <span title="Not matched to a roster character">{label}</span>
      )}
    </span>
  );
}

interface Group {
  /** Left-hand label shown once, on the group's first row. */
  label: string;
  rows: ConsumableTypeRow[];
}

/**
 * The raid's consumables by type — boss pulls and trash — each foldable to reveal which
 * raiders used it and how many they threw — the same providers pattern as the
 * cooldown table, but per potion / item (sappers included). Click a type to
 * expand.
 */
export function ConsumableUsageTable({
  potions,
  items,
}: {
  potions: ConsumableTypeRow[];
  items: ConsumableTypeRow[];
}) {
  const [open, setOpen] = React.useState<Record<string, boolean>>({});
  const groups: Group[] = [
    { label: "Potions", rows: potions },
    { label: "Items", rows: items },
  ].filter((g) => g.rows.length > 0);

  if (groups.length === 0) {
    return <p className="py-1 text-sm text-muted-foreground">No consumables used.</p>;
  }

  return (
    <Table>
      <TableBody>
        {groups.flatMap((group) =>
          group.rows.map((t, i) => {
            const key = `${group.label}:${t.name}`;
            const isOpen = open[key] === true;
            return (
              <React.Fragment key={key}>
                <TableRow
                  className="cursor-pointer"
                  onClick={() => setOpen((o) => ({ ...o, [key]: !isOpen }))}
                  title="Show who used it"
                  aria-expanded={isOpen}
                >
                  <TableCell className="w-6 pr-0">
                    <ChevronRight
                      className={cn(
                        "h-3.5 w-3.5 text-muted-foreground transition-transform",
                        isOpen && "rotate-90",
                      )}
                      aria-hidden
                    />
                  </TableCell>
                  <TableCell className="w-20 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {i === 0 ? group.label : ""}
                  </TableCell>
                  <TableCell className="text-sm">{t.name}</TableCell>
                  <TableCell className="w-24 text-right text-sm tabular-nums">
                    ×{t.uses}
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {t.providers.length} player{t.providers.length === 1 ? "" : "s"}
                    </span>
                  </TableCell>
                </TableRow>
                {isOpen && (
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableCell colSpan={4} className="px-4 py-2.5">
                      <span className="flex flex-wrap gap-1.5">
                        {t.providers.map((p) => (
                          <Provider key={p.name} name={p.name} slug={p.slug} count={p.count} />
                        ))}
                      </span>
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            );
          }),
        )}
      </TableBody>
    </Table>
  );
}
