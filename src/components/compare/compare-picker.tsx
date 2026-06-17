"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { CLASS_TEXT_COLORS } from "@/lib/constants/wow";
import type { WowClass } from "@/lib/types";
import { cn } from "@/lib/utils";

/** One choosable character for the picker. */
export interface PickerCharacter {
  slug: string;
  name: string;
  wowClass: WowClass;
  spec: string;
  status: string;
}

const MAX = 4;

/**
 * Up-to-4 character selector that drives the comparison via the URL
 * (?chars=a,b,c) so a comparison is shareable and bookmarkable. Selected
 * characters show as removable, class-colored chips; an add menu lists the
 * rest, filterable by name.
 */
export function ComparePicker({
  all,
  selected,
}: {
  all: PickerCharacter[];
  selected: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const wrapRef = React.useRef<HTMLDivElement>(null);

  const bySlug = React.useMemo(() => new Map(all.map((c) => [c.slug, c])), [all]);
  const selectedSet = new Set(selected);

  const push = (slugs: string[]) => {
    const next = slugs.slice(0, MAX);
    router.push(next.length > 0 ? `/compare?chars=${next.map(encodeURIComponent).join(",")}` : "/compare");
  };

  const add = (slug: string) => {
    if (selectedSet.has(slug) || selected.length >= MAX) return;
    push([...selected, slug]);
    setQuery("");
    setOpen(false);
  };
  const remove = (slug: string) => push(selected.filter((s) => s !== slug));

  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const candidates = all
    .filter((c) => !selectedSet.has(c.slug))
    .filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()));

  const full = selected.length >= MAX;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {selected.map((slug) => {
        const c = bySlug.get(slug);
        if (!c) return null;
        return (
          <span
            key={slug}
            className="inline-flex items-center gap-1.5 rounded-full border bg-card py-1 pl-2.5 pr-1 text-sm shadow-xs"
          >
            <span className="font-medium" style={{ color: CLASS_TEXT_COLORS[c.wowClass] }}>
              {c.name}
            </span>
            <button
              type="button"
              aria-label={`Remove ${c.name}`}
              onClick={() => remove(slug)}
              className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        );
      })}

      <div ref={wrapRef} className="relative">
        <button
          type="button"
          disabled={full}
          onClick={() => setOpen((o) => !o)}
          title={full ? `Comparing the maximum of ${MAX} characters` : undefined}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          <Plus className="h-3.5 w-3.5" />
          {selected.length === 0 ? "Add characters" : full ? "Max 4" : "Add"}
        </button>

        {open && !full && (
          <div className="absolute left-0 top-full z-50 mt-1.5 w-64 overflow-hidden rounded-md border bg-popover shadow-md">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by name…"
              className="w-full border-b bg-transparent px-3 py-2 text-sm focus-visible:outline-none"
            />
            {candidates.length === 0 ? (
              <p className="px-3 py-2.5 text-sm text-muted-foreground">No more characters.</p>
            ) : (
              <ul className="max-h-72 overflow-y-auto py-1">
                {candidates.map((c) => (
                  <li key={c.slug}>
                    <button
                      type="button"
                      onClick={() => add(c.slug)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
                    >
                      <span className="font-medium" style={{ color: CLASS_TEXT_COLORS[c.wowClass] }}>
                        {c.name}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {c.spec}
                        {c.status !== "main" && ` · ${c.status}`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
