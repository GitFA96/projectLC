"use client";

import * as React from "react";
import { Loader2, Pencil, RotateCcw } from "lucide-react";
import { saveItemPriorityAction, saveLootWeightsAction } from "@/app/loot-policy-actions";
import { SPEC_TAGS } from "@/lib/loot/spec-tags";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ItemPriorityRule, LootPriorityFactorKey, LootPriorityWeights } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The two knobs that ARE the guild's loot policy: which specs come first on a
 * given item, and how much each metric counts once the specs tie.
 *
 * Both are seeded — the chain from the guild's own priority sheet, the weights
 * from the app's defaults — and both are editable here rather than in a config
 * file, because they're the parts a council changes after an argument, not
 * between deploys. Clearing an item's chain hands it back to the sheet, so an
 * edit is never a one-way door.
 */

/** Tokens a chain can be written in, minus the catch-alls every chain ends with. */
const SUGGESTIONS = SPEC_TAGS.filter((t) => t !== "MS" && t !== "OS");

export function ItemPriorityEditor({
  itemName,
  rule,
}: {
  itemName: string;
  /** The chain in force — the seeded sheet's, or an officer's edit of it. */
  rule?: ItemPriorityRule;
}) {
  const [editing, setEditing] = React.useState(false);
  const [chain, setChain] = React.useState(rule?.chain ?? "");
  const [error, setError] = React.useState<string | null>(null);
  const [warning, setWarning] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const save = (next: string) => {
    setError(null);
    setWarning(null);
    startTransition(async () => {
      const result = await saveItemPriorityAction({ itemName, chain: next });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if (result.manualTokens && result.manualTokens.length > 0) {
        setWarning(
          `Saved. “${result.manualTokens.join("”, “")}” isn't a spec the app knows, so it's shown to the council but can't rank anyone.`,
        );
      }
      setEditing(false);
    });
  };

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {rule ? (
          <>
            <span className="flex flex-wrap items-center gap-1">
              {rule.tiers.map((tier, i) => (
                <React.Fragment key={`${tier.tags.join()}-${i}`}>
                  {i > 0 && <span className="text-xs text-muted-foreground">›</span>}
                  <Badge
                    variant={tier.manual ? "warning" : "secondary"}
                    className="font-normal"
                    title={
                      tier.manual
                        ? "A judgement call the sheet is asking a human to make — it ranks nobody"
                        : `Priority ${i + 1}`
                    }
                  >
                    {tier.tags.join(" = ")}
                  </Badge>
                </React.Fragment>
              ))}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {rule.origin === "officer"
                ? "edited here"
                : `from the guild sheet${rule.source ? ` · ${rule.source}` : ""}`}
            </span>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">
            No spec priority on the sheet for this item — metrics decide it alone.
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-1.5 text-xs"
          onClick={() => {
            setChain(rule?.chain ?? "");
            setEditing(true);
          }}
        >
          <Pencil className="h-3 w-3" /> Edit
        </Button>
        {rule?.origin === "officer" && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-xs text-muted-foreground"
            disabled={pending}
            onClick={() => save("")}
            title="Drop this edit and use the guild's sheet again"
          >
            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
            Reset to sheet
          </Button>
        )}
        {warning && <p className="w-full text-[11px] text-amber-700">{warning}</p>}
        {error && <p className="w-full text-[11px] text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="priority-chain" className="text-xs">
        Spec priority — <span className="font-normal text-muted-foreground">
          `&gt;` steps down, `=` is equal priority. End with MS &gt; OS to catch everyone else.
        </span>
      </Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id="priority-chain"
          value={chain}
          onChange={(e) => setChain(e.target.value)}
          placeholder="Hunter > DPS Warrior > MS > OS"
          className="h-8 min-w-72 flex-1"
          autoFocus
        />
        <Button size="sm" disabled={pending} onClick={() => save(chain)}>
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
        </Button>
        <Button variant="outline" size="sm" disabled={pending} onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Known specs:{" "}
        {SUGGESTIONS.map((tag, i) => (
          <React.Fragment key={tag}>
            {i > 0 && ", "}
            <button
              type="button"
              className="cursor-pointer underline-offset-2 hover:underline"
              onClick={() => setChain((c) => (c.trim() ? `${c.trim()} > ${tag}` : tag))}
            >
              {tag}
            </button>
          </React.Fragment>
        ))}
        . Common spellings resolve to these — “Holy Priest” and “Disc Priest” both mean Healing
        Priest, which is one loot pool. Anything else is kept and shown, but ranks nobody.
      </p>
      {error && <p className="text-[11px] text-red-600">{error}</p>}
    </div>
  );
}

const FACTOR_LABELS: Record<LootPriorityFactorKey, string> = {
  attendance: "Attendance",
  lootDebt: "Loot owed",
  performance: "Performance",
  preparation: "Preparation",
};

/**
 * The factor weighting. Values are relative, not a budget — the score is a
 * weighted mean, so 35/30/20/15 and 70/60/40/30 rank identically. The running
 * total is shown anyway because councils think in percentages.
 */
export function LootWeightsEditor({ weights }: { weights: LootPriorityWeights }) {
  const [draft, setDraft] = React.useState(weights);
  const [saved, setSaved] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const total = Object.values(draft).reduce((a, b) => a + b, 0);
  const dirty = (Object.keys(draft) as LootPriorityFactorKey[]).some((k) => draft[k] !== weights[k]);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(Object.keys(FACTOR_LABELS) as LootPriorityFactorKey[]).map((key) => (
          <div key={key} className="space-y-1">
            <Label htmlFor={`w-${key}`} className="text-xs">
              {FACTOR_LABELS[key]}
            </Label>
            <div className="flex items-center gap-2">
              <input
                id={`w-${key}`}
                type="range"
                min={0}
                max={60}
                value={draft[key]}
                onChange={(e) => {
                  setSaved(null);
                  setDraft((d) => ({ ...d, [key]: Number(e.target.value) }));
                }}
                className="h-1.5 flex-1 cursor-pointer accent-emerald-600"
              />
              <span className="w-10 shrink-0 text-right text-sm font-medium tabular-nums">
                {total === 0 ? 0 : Math.round((draft[key] / total) * 100)}%
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={pending || !dirty}
          onClick={() => {
            setError(null);
            setSaved(null);
            startTransition(async () => {
              const result = await saveLootWeightsAction(draft);
              if (result.ok) setSaved(result.message);
              else setError(result.message);
            });
          }}
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save weighting
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={pending || !dirty}
          onClick={() => {
            setDraft(weights);
            setSaved(null);
            setError(null);
          }}
        >
          Discard
        </Button>
        <span className={cn("text-xs", saved ? "text-emerald-700" : "text-muted-foreground")}>
          {saved ??
            "Relative, not a budget — only the ratios matter. Saving re-ranks every contested item."}
        </span>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </div>
  );
}
