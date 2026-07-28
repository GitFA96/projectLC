"use client";

import * as React from "react";
import { Check } from "lucide-react";
import type { RaidFight } from "@/lib/types";
import { saveReportFightFilter } from "@/app/logs/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The night's pull list, doubling as the switch for which pulls count.
 * Officers turn off the ones that would only add noise — a joke pull, a
 * two-man farm boss, a wipe called five seconds in — and everything derived
 * from the report (preparation coverage, potion and in-fight item counts,
 * cooldowns, debuff averages, uptime and the player-improvement list)
 * recomputes without them.
 *
 * Rendered inside the raid's header card: the pull list has to be there
 * anyway, so the toggle rides along instead of taking a card of its own. The
 * selection is saved per report, so it survives a re-fetch of the log.
 */
export function FightFilter({ code, fights }: { code: string; fights: RaidFight[] }) {
  const savedExcluded = React.useMemo(
    () => fights.filter((f) => f.excluded).map((f) => f.fightId),
    [fights],
  );
  const [excluded, setExcluded] = React.useState<number[]>(savedExcluded);
  const [pending, startTransition] = React.useTransition();
  const [msg, setMsg] = React.useState<string | null>(null);

  const isOn = (fightId: number) => !excluded.includes(fightId);
  const toggle = (fightId: number) => {
    setExcluded((e) => (e.includes(fightId) ? e.filter((id) => id !== fightId) : [...e, fightId]));
    setMsg(null);
  };
  const setAll = (ids: number[]) => {
    setExcluded(ids);
    setMsg(null);
  };

  const dirty =
    excluded.length !== savedExcluded.length || excluded.some((id) => !savedExcluded.includes(id));
  const includedCount = fights.length - excluded.length;

  const save = () =>
    startTransition(async () => {
      const res = await saveReportFightFilter({ code, excludedFightIds: excluded });
      setMsg(res.message);
    });

  if (fights.length === 0) return null;

  return (
    <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {fights.map((f) => {
            const on = isOn(f.fightId);
            return (
              <button
                key={f.fightId}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(f.fightId)}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
                  on
                    ? f.kill
                      ? "border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100"
                      : "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
                    : "border-dashed text-muted-foreground/60 line-through hover:bg-accent",
                )}
              >
                {on && <Check className="h-3 w-3" aria-hidden />}
                {f.encounterName}
                <span className="opacity-70">
                  {f.kill
                    ? "kill"
                    : f.fightPercentage !== undefined
                      ? `${Math.round(f.fightPercentage)}%`
                      : "wipe"}
                </span>
              </button>
            );
          })}
        </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          {includedCount} of {fights.length} pulls counted — click one to leave it out of this
          night&apos;s preparation, consumable, uptime and improvement numbers.
        </span>
        <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => setAll([])} disabled={excluded.length === 0}>
          Count all
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2"
          onClick={() => setAll(fights.filter((f) => !f.kill).map((f) => f.fightId))}
        >
          Kills only
        </Button>
        {dirty && (
          <Button size="sm" className="h-6 px-2" onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        )}
        {msg && <span>{msg}</span>}
      </div>
    </div>
  );
}
