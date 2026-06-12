"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { ItemIcon } from "@/components/item-icon";
import { Badge } from "@/components/ui/badge";
import { QUALITY_TEXT_COLORS, SLOT_LABELS } from "@/lib/constants/wow";
import { rankItemMatches, type QuickSearchItem } from "@/lib/analysis/quick-search";

/**
 * The "something just dropped" lookup, reachable from every page: focus with
 * "/" or Ctrl/Cmd+K, type a few letters, Enter opens the item's contention
 * page (who has it wishlisted, who already won it).
 */
export function QuickSearch({ items }: { items: QuickSearchItem[] }) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);

  const results = React.useMemo(() => rankItemMatches(items, query), [items, query]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable;
      if ((e.key === "/" && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (itemId: number) => {
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
    router.push(`/items/${itemId}`);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = results[Math.min(active, results.length - 1)];
      if (hit) go(hit.itemId);
    }
  };

  const show = open && query.trim().length >= 2;

  return (
    <div className="relative hidden w-64 md:block">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={show}
        aria-controls="quick-search-results"
        aria-label="Find an item"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        placeholder="Find an item…  ( / )"
        className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-2 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      {show && (
        <div
          id="quick-search-results"
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-md border bg-popover shadow-md"
        >
          {results.length === 0 ? (
            <p className="px-3 py-2.5 text-sm text-muted-foreground">
              No tracked item matches “{query.trim()}”.
            </p>
          ) : (
            <ul className="max-h-96 overflow-y-auto py-1">
              {results.map((item, i) => (
                <li key={item.itemId}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    // Fire before the input's blur closes the panel.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => go(item.itemId)}
                    onMouseEnter={() => setActive(i)}
                    className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm ${
                      i === active ? "bg-accent" : ""
                    }`}
                  >
                    <ItemIcon icon={item.icon} quality={item.quality ?? "common"} size={22} />
                    <span className="min-w-0 flex-1">
                      <span
                        className="block truncate font-medium"
                        style={{ color: QUALITY_TEXT_COLORS[item.quality ?? "common"] }}
                      >
                        {item.name}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {item.slot ? SLOT_LABELS[item.slot] : "—"}
                      </span>
                    </span>
                    {item.openCount > 0 ? (
                      <Badge variant="warning" className="tabular-nums">
                        {item.openCount} open
                      </Badge>
                    ) : item.wisherCount > 0 ? (
                      <Badge variant="muted" className="tabular-nums">
                        {item.wisherCount} want
                      </Badge>
                    ) : (
                      <span className="text-[11px] text-muted-foreground/60">no wishers</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="border-t bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
            ↑↓ to choose · Enter opens who-wants-it · Esc closes
          </p>
        </div>
      )}
    </div>
  );
}
