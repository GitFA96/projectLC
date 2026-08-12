"use client";

import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";

import { compareText } from "@/lib/sort";

/**
 * Per-buff display state shared by the fight graphs. Interaction lives on the
 * lanes themselves: click toggles highlight on/off (no need to pass through
 * hidden to deselect), double-click hides. Highlighting dims every other lane
 * — buffs AND consume lanes/markers — the emphasis pattern; hidden lanes come
 * back via the HiddenBuffsMenu above the chart. Absent from the map = shown.
 */
export type BuffFilterState = Record<string, "highlight" | "hidden">;

/** Click: highlight ↔ normal. */
export function toggleHighlight(filter: BuffFilterState, name: string): BuffFilterState {
  const next = { ...filter };
  if (next[name] === "highlight") delete next[name];
  else next[name] = "highlight";
  return next;
}

/** Double-click: hide (the two preceding clicks cancel out — toggle on, off). */
export function hideBuff(filter: BuffFilterState, name: string): BuffFilterState {
  return { ...filter, [name]: "hidden" };
}

export function anyHighlight(filter: BuffFilterState | undefined): boolean {
  return !!filter && Object.values(filter).some((v) => v === "highlight");
}

/** True when the lane should render dimmed (something else is highlighted). */
export function isDimmed(name: string, filter: BuffFilterState | undefined): boolean {
  return anyHighlight(filter) && filter?.[name] !== "highlight";
}

/** The re-show menu: only appears once something is hidden. */
export function HiddenBuffsMenu({
  filter,
  onChange,
}: {
  filter: BuffFilterState;
  onChange: (next: BuffFilterState) => void;
}) {
  const hidden = Object.keys(filter)
    .filter((name) => filter[name] === "hidden")
    .sort((a, b) => compareText(a, b));
  const anyState = Object.keys(filter).length > 0;
  if (!anyState) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {hidden.length > 0 && (
        <>
          <span className="inline-flex items-center gap-1 pr-1 text-[11px] text-muted-foreground">
            <EyeOff className="h-3 w-3" /> Hidden:
          </span>
          {hidden.map((name) => (
            <button
              key={name}
              type="button"
              title={`Show ${name} again`}
              className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground line-through transition-colors hover:bg-accent hover:text-foreground hover:no-underline"
              onClick={() => {
                const next = { ...filter };
                delete next[name];
                onChange(next);
              }}
            >
              {name}
            </button>
          ))}
        </>
      )}
      <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => onChange({})}>
        <Eye className="h-3 w-3" /> Reset
      </Button>
    </div>
  );
}
