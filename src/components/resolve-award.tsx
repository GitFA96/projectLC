"use client";

import * as React from "react";
import { Check, TriangleAlert } from "lucide-react";
import { resolveAwardAction, type ResolveAwardInput } from "@/app/loot/actions";
import { cn } from "@/lib/utils";
import { resolveControlFace, type ResolveMode } from "@/components/loot/resolve-face";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface ResolveRosterOption {
  id: string;
  name: string;
}

/**
 * Inline winner resolution: a Select used as an action menu (value stays ""
 * so the trigger always reads as a button, and so picking the same option
 * twice still fires). On success the server action revalidates and the ledger
 * re-renders with the new winner.
 */
export function ResolveAwardControl({
  awardId,
  mode,
  roster,
}: {
  awardId: string;
  /** "unresolved" = needs attention; "external" = settled off-roster (offer undo). */
  mode: ResolveMode;
  roster: ResolveRosterOption[];
}) {
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string>();
  const face = resolveControlFace(mode);

  function onChoose(value: string) {
    const input: ResolveAwardInput = value.startsWith("chr:")
      ? { awardId, resolution: "character", characterId: value.slice(4) }
      : { awardId, resolution: value === "external" ? "external" : "unresolved" };
    setError(undefined);
    startTransition(async () => {
      const result = await resolveAwardAction(input);
      if (!result.ok) setError(result.message);
    });
  }

  return (
    <span className="inline-flex items-center gap-1">
      <Select value="" onValueChange={onChoose} disabled={pending}>
        <SelectTrigger
          title={face.title}
          aria-label={`Winner: ${face.label}`}
          className={cn(
            "h-6 w-auto gap-0.5 px-2 text-xs shadow-none",
            // An open question is dashed and inked like the badge beside it; a
            // settled one is flat and quiet, so a full ledger reads at a glance.
            face.open
              ? "border-dashed border-warn-line text-warn-ink"
              : "border-transparent bg-muted text-muted-foreground",
          )}
        >
          {!face.open && !pending && <Check className="h-3 w-3 shrink-0" />}
          <SelectValue placeholder={pending ? "Saving…" : face.label} />
        </SelectTrigger>
        <SelectContent align="end">
          {mode === "external" ? (
            <SelectItem value="unresolved">Mark unresolved</SelectItem>
          ) : (
            <SelectItem value="external">Off roster (DE / bank / PUG)</SelectItem>
          )}
          <SelectGroup>
            <SelectLabel>Assign to</SelectLabel>
            {roster.map((c) => (
              <SelectItem key={c.id} value={`chr:${c.id}`}>
                {c.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {error && (
        <span title={error}>
          <TriangleAlert className="h-3.5 w-3.5 text-destructive" />
        </span>
      )}
    </span>
  );
}
