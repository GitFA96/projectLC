"use client";

import * as React from "react";
import { TriangleAlert } from "lucide-react";
import { resolveAwardAction, type ResolveAwardInput } from "@/app/loot/actions";
import {
  Select,
  SelectContent,
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
 * so the trigger always reads as a button). On success the server action
 * revalidates and the ledger re-renders with the new winner.
 */
export function ResolveAwardControl({
  awardId,
  mode,
  roster,
}: {
  awardId: string;
  /** "unresolved" = needs attention; "external" = settled off-roster (offer undo). */
  mode: "unresolved" | "external";
  roster: ResolveRosterOption[];
}) {
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string>();

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
        <SelectTrigger className="h-6 w-auto gap-0.5 border-dashed px-2 text-xs text-muted-foreground shadow-none">
          <SelectValue placeholder={pending ? "Saving…" : "Resolve"} />
        </SelectTrigger>
        <SelectContent align="end">
          {mode === "external" ? (
            <SelectItem value="unresolved">Mark unresolved</SelectItem>
          ) : (
            <SelectItem value="external">Off roster (DE / bank / PUG)</SelectItem>
          )}
          <SelectLabel>Assign to</SelectLabel>
          {roster.map((c) => (
            <SelectItem key={c.id} value={`chr:${c.id}`}>
              {c.name}
            </SelectItem>
          ))}
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
