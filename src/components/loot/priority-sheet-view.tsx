"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/empty-state";
import { ItemLink } from "@/components/item-link";
import { ItemPriorityEditor } from "@/components/loot/priority-editor";
import type { Quality } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The council's sheet, readable as a document.
 *
 * Serializable rows rather than the analysis type: this crosses the server
 * boundary, and the page resolves item links before it gets here.
 */
export interface SheetRow {
  itemName: string;
  chain: string;
  tiers: { tags: string[]; manual: boolean }[];
  origin: "sheet" | "officer";
  sheetChain?: string;
  slotLabel?: string;
  note?: string;
  itemId?: number;
  quality?: Quality;
  icon?: string;
  shadowed?: boolean;
}

export interface SheetSection {
  source: string;
  rows: SheetRow[];
}

/**
 * A chain as rungs rather than a string: the `>` between tiers is the whole
 * meaning of the notation, and tiers the app can't evaluate are drawn muted
 * because nobody gets ranked into them.
 */
function Chain({ tiers, chain }: { tiers: SheetRow["tiers"]; chain: string }) {
  if (tiers.length === 0) return <span className="text-muted-foreground">{chain}</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
      {tiers.map((tier, i) => (
        <React.Fragment key={`${tier.tags.join("=")}-${i}`}>
          {i > 0 && <span className="text-muted-foreground/60">&gt;</span>}
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-xs",
              tier.manual
                ? "bg-warn-soft text-warn-ink"
                : "bg-secondary text-secondary-foreground",
            )}
            title={tier.manual ? "A judgement call for the council — nobody is ranked into it" : undefined}
          >
            {tier.tags.join(" = ")}
          </span>
        </React.Fragment>
      ))}
    </span>
  );
}

function Row({ row }: { row: SheetRow }) {
  const [editing, setEditing] = React.useState(false);

  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-1 border-t px-3 py-2 text-sm sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]">
      <div className="min-w-0">
        {/* An item the cache matched renders exactly as it does everywhere
            else — icon, quality colour, Wowhead hover. A name the cache has
            never seen stays plain text: there is no id to link or hover. */}
        {row.itemId ? (
          <ItemLink
            item={{ itemId: row.itemId, name: row.itemName, quality: row.quality, icon: row.icon }}
          />
        ) : (
          <span className="font-medium">{row.itemName}</span>
        )}
        {row.slotLabel && (
          <span className="ml-2 text-xs text-muted-foreground">{row.slotLabel}</span>
        )}
      </div>

      <div className="min-w-0">
        {editing ? (
          /* Keyed on the chain so that saving — which re-renders the row with
             the new chain — resets the editor rather than leaving the old
             draft in a mounted input.

             `formOnly`: this row already draws the chain and owns the button
             that got you here, so the editor must not bring a second read view
             and a second Edit button along with it. */
          <ItemPriorityEditor
            key={row.chain}
            itemName={row.itemName}
            formOnly
            onDone={() => setEditing(false)}
            rule={{
              itemName: row.itemName,
              chain: row.chain,
              tiers: row.tiers,
              origin: row.origin,
              note: row.note,
            }}
          />
        ) : (
          <>
            <Chain tiers={row.tiers} chain={row.chain} />
            {row.sheetChain && (
              <div className="mt-1 text-xs text-muted-foreground">
                Sheet says <span className="line-through">{row.sheetChain}</span>
              </div>
            )}
            {row.note && <div className="mt-1 text-xs text-muted-foreground">{row.note}</div>}
          </>
        )}
      </div>

      <div className="flex items-start gap-1.5">
        {/* Mounted per row on demand rather than for every row at once: a
            pasted sheet runs to hundreds of rows, and each editor carries its
            own state and transition.

            Hidden while the form is open: the form has its own Save and
            Cancel, and a third button beside them only invites the question of
            which one commits. */}
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Change who this item goes to first — saved as an officer edit over the sheet"
          >
            Edit
          </button>
        )}
        {row.origin === "officer" && (
          <Badge variant="secondary" className="shrink-0">
            Officer edit
          </Badge>
        )}
        {row.shadowed && (
          <Badge
            variant="warning"
            className="shrink-0"
            title="An earlier row in the sheet claims this name, so this one never applies"
          >
            Shadowed
          </Badge>
        )}
      </div>
    </div>
  );
}

const matches = (row: SheetRow, q: string) =>
  row.itemName.toLowerCase().includes(q) ||
  row.chain.toLowerCase().includes(q) ||
  (row.slotLabel?.toLowerCase().includes(q) ?? false);

export function PrioritySheetView({
  sections,
  unlisted,
}: {
  sections: SheetSection[];
  unlisted: SheetRow[];
}) {
  const [query, setQuery] = React.useState("");
  const q = query.trim().toLowerCase();

  const visible = React.useMemo(() => {
    if (!q) return sections;
    return sections
      // A section whose heading matches keeps all its rows — searching a boss
      // name should give you that boss's table, not the rows that happen to
      // repeat its name.
      .map((s) =>
        s.source.toLowerCase().includes(q)
          ? s
          : { ...s, rows: s.rows.filter((r) => matches(r, q)) },
      )
      .filter((s) => s.rows.length > 0);
  }, [sections, q]);

  const visibleUnlisted = React.useMemo(
    () => (q ? unlisted.filter((r) => matches(r, q)) : unlisted),
    [unlisted, q],
  );

  const shown = visible.reduce((n, s) => n + s.rows.length, 0) + visibleUnlisted.length;

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Item, boss, spec or slot…"
          className="pl-8"
          aria-label="Search the priority sheet"
        />
      </div>

      {q && (
        <p className="text-xs text-muted-foreground">
          {shown} {shown === 1 ? "row" : "rows"} match “{query.trim()}”
        </p>
      )}

      {shown === 0 ? (
        <EmptyState
          title="Nothing matches"
          description="The sheet lists items by the name the council wrote, which can differ from the item cache."
        />
      ) : (
        <>
          {visible.map((section) => (
            <section key={section.source} className="overflow-hidden rounded-xl border bg-card">
              <h2 className="px-3 py-2 text-sm font-semibold">{section.source}</h2>
              {section.rows.map((row, i) => (
                <Row key={`${row.itemName}-${i}`} row={row} />
              ))}
            </section>
          ))}

          {visibleUnlisted.length > 0 && (
            <section className="overflow-hidden rounded-xl border bg-card">
              <div className="px-3 py-2">
                <h2 className="text-sm font-semibold">Not on any sheet</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Chains an officer wrote for items no sheet lists. They aren&apos;t tied to a
                  phase — an officer&apos;s chain for an item is their chain for it — so they show
                  here whichever phase you&apos;re reading, and they apply exactly like the rest.
                </p>
              </div>
              {visibleUnlisted.map((row, i) => (
                <Row key={`${row.itemName}-${i}`} row={row} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
