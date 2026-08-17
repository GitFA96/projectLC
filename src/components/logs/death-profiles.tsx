import { ChevronRight } from "lucide-react";
import { CharacterLink } from "@/components/class-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { BossDeathProfile, BossPullDeaths, DeathEvent } from "@/lib/analysis/deaths";
import type { WowClass } from "@/lib/constants/wow";
import { cn } from "@/lib/utils";

/**
 * "Hvorfor sliter vi på denne bossen?"
 *
 * The death count was already on the page and it never answered the question:
 * it can't tell an opener nobody survives from attrition at 40%, and those need
 * opposite fixes. The median first death does, and the shape of the pull says
 * whether deaths cluster at one moment or bleed across the whole fight.
 *
 * **The cause comes from the log, never from us.** Warcraft Logs names the
 * killing blow on every death event it serves, so a death can say "Melee from
 * Fathom-Guard Sharkkis" because the log said so. What is still not inferred is
 * anything the log doesn't state: no reading "died to Flame Wreath" off a clock,
 * and a killer the report doesn't name stays unnamed.
 *
 * The aggregate answers "why do we struggle here"; the per-pull list under it
 * answers "what happened on that attempt", kills and wipes kept apart because a
 * clean kill and a 40% wipe are not the same evidence.
 */
export function DeathProfiles({
  profiles,
  wowClassOf,
}: {
  profiles: BossDeathProfile[];
  wowClassOf: (actorName: string) => WowClass | undefined;
}) {
  const worth = profiles.filter((p) => p.deathsTotal > 0);
  if (worth.length === 0) {
    return (
      <p className="py-2 text-sm text-muted-foreground">
        Nobody died on a boss pull this night.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {worth.map((profile) => (
        <Card key={profile.encounterId}>
          <CardHeader className="space-y-1.5">
            <CardTitle className="flex flex-wrap items-baseline gap-2 text-base">
              {profile.encounterName}
              <span className="text-xs font-normal text-muted-foreground">
                {profile.wipes} wipe{profile.wipes === 1 ? "" : "s"}
                {profile.kills > 0 && `, ${profile.kills} kill${profile.kills === 1 ? "" : "s"}`} ·{" "}
                {profile.deathsTotal} death{profile.deathsTotal === 1 ? "" : "s"}
              </span>
            </CardTitle>
            {profile.timingMissing ? (
              <p className="rounded-md border border-warn-line bg-warn-soft px-2 py-1.5 text-xs text-warn-ink">
                This report was imported before death timing was kept — the deaths are counted but
                not placed. Re-import it and this fills in.
              </p>
            ) : (
              profile.medianFirstDeathMs !== undefined && (
                <p className="text-xs text-muted-foreground">
                  First death typically at{" "}
                  <span className="font-medium text-foreground">
                    {formatMs(profile.medianFirstDeathMs)}
                  </span>{" "}
                  — median across the pulls that had one.
                </p>
              )
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {!profile.timingMissing && <TenthBars byTenth={profile.byTenth} />}

            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {profile.offenders.slice(0, 8).map((o) => {
                const wowClass = wowClassOf(o.actorName);
                return (
                  <span key={o.actorName} className="flex items-center gap-1.5 text-xs">
                    {wowClass ? (
                      <CharacterLink name={o.actorName} wowClass={wowClass} className="text-xs" />
                    ) : (
                      <span className="font-medium">{o.actorName}</span>
                    )}
                    <span className="tabular-nums text-muted-foreground">
                      {o.deaths} in {o.pulls} pull{o.pulls === 1 ? "" : "s"}
                    </span>
                    {o.firstDeaths > 0 && (
                      <Badge
                        variant="muted"
                        className="font-normal"
                        title="How often they were the first down on a pull"
                      >
                        first ×{o.firstDeaths}
                      </Badge>
                    )}
                  </span>
                );
              })}
            </div>

            <PullBreakdown pulls={profile.pulls} wowClassOf={wowClassOf} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/**
 * The hits that led to one death, newest first — the "last 10 seconds".
 *
 * Behind a toggle because it is the detail you want on the one death you are
 * arguing about, not on all 28 of them at once. The killing blow is already on
 * the line above; this is the run-up, which is what distinguishes being ground
 * down from standing in something from one enormous hit.
 *
 * A `<details>` rather than React state: one per death on a page that can carry
 * hundreds, and the browser's own disclosure costs nothing per row.
 */
function Recap({ hits }: { hits: NonNullable<DeathEvent["recap"]> }) {
  const total = hits.reduce((sum, h) => sum + h.amount, 0);
  return (
    <details className="ml-1 inline-block align-middle">
      <summary className="cursor-pointer list-none text-[11px] text-muted-foreground/70 underline-offset-2 hover:text-foreground hover:underline">
        last {hits.length} hit{hits.length === 1 ? "" : "s"}
        {total > 0 && ` · ${total.toLocaleString("en-US")}`}
      </summary>
      <ul className="mt-0.5 space-y-0.5 border-l pl-2">
        {hits.map((hit, i) => (
          <li key={`${hit.atMs}-${hit.ability}-${i}`} className="flex flex-wrap items-baseline gap-x-1.5 text-[11px]">
            <span className="w-10 shrink-0 tabular-nums text-muted-foreground">{formatMs(hit.atMs)}</span>
            <span className="tabular-nums font-medium">{hit.amount.toLocaleString("en-US")}</span>
            <span className="text-muted-foreground">{hit.ability}</span>
            {hit.source && <span className="text-muted-foreground/70">from {hit.source}</span>}
            {hit.absorbed !== undefined && (
              <span className="text-muted-foreground/70" title="Eaten by a shield">
                ({hit.absorbed.toLocaleString("en-US")} absorbed)
              </span>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Every attempt at this boss, in the order they happened.
 *
 * The aggregate above stacks all the pulls together, which is right for "when do
 * we lose people" and wrong for "what went wrong on the attempt we remember".
 * Each pull keeps its own result, its own length — the kill timer included — and
 * its own deaths in order.
 *
 * Pulls with nobody down are listed too. "Which attempt went clean" is part of
 * the same question, and a gap in a numbered list invites the wrong guess.
 *
 * Folded away by default: a night of progression puts one of these under every
 * boss, and it is the list you open for the attempt being argued about rather
 * than something to scroll past on the way to the next boss. The summary keeps
 * the kill count, so folding it costs nothing — "did we kill it" has to stay
 * answerable without opening anything.
 *
 * A `<details>` for the same reason `Recap` above is one: several per page, and
 * the browser's own disclosure needs no state and no client component.
 */
function PullBreakdown({
  pulls,
  wowClassOf,
}: {
  pulls: BossPullDeaths[];
  wowClassOf: (actorName: string) => WowClass | undefined;
}) {
  if (pulls.length === 0) return null;

  const kills = pulls.filter((p) => p.kill).length;

  return (
    <details className="rounded-md border [&[open]>summary_.chevron]:rotate-90">
      <summary className="flex cursor-pointer list-none items-center gap-1 px-2.5 py-1.5 text-xs font-medium hover:bg-accent">
        <ChevronRight className="chevron h-3 w-3 shrink-0 text-muted-foreground transition-transform" aria-hidden />
        Pull by pull
        <span className="font-normal text-muted-foreground">
          {pulls.length} attempt{pulls.length === 1 ? "" : "s"}, in order ·{" "}
          {kills === 0 ? "no kill" : `${kills} kill${kills === 1 ? "" : "s"}`}
        </span>
      </summary>
      <ul className="divide-y border-t">
        {pulls.map((pull, i) => (
          <li key={pull.fightId} className="px-2.5 py-1.5">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
              <span className="text-muted-foreground">#{i + 1}</span>
              {pull.kill ? (
                <Badge variant="success" className="font-normal">
                  Kill {formatMs(pull.durationMs)}
                </Badge>
              ) : (
                <Badge variant="warning" className="font-normal">
                  Wipe{pull.fightPercentage !== undefined && ` at ${pull.fightPercentage.toFixed(1)}%`}
                </Badge>
              )}
              <span className="tabular-nums text-muted-foreground">
                {!pull.kill && `${formatMs(pull.durationMs)} · `}
                {pull.deaths.length === 0
                  ? "nobody down"
                  : `${pull.deaths.length} death${pull.deaths.length === 1 ? "" : "s"}`}
              </span>
            </div>

            {pull.deaths.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {[...pull.deaths]
                  .sort((a, b) => a.atMs - b.atMs)
                  .map((death, j) => {
                    const wowClass = wowClassOf(death.actorName);
                    return (
                      <li
                        key={`${death.actorName}-${death.atMs}-${j}`}
                        className="flex flex-wrap items-baseline gap-x-1.5 text-xs"
                      >
                        <span className="w-10 shrink-0 tabular-nums text-muted-foreground">
                          {formatMs(death.atMs)}
                        </span>
                        {wowClass ? (
                          <CharacterLink name={death.actorName} wowClass={wowClass} className="text-xs" />
                        ) : (
                          <span className="font-medium">{death.actorName}</span>
                        )}
                        {/* Only what the log stated. No killing blow recorded is
                            a real answer for a report imported before it was
                            kept, and saying nothing beats filling the gap in. */}
                        {death.ability || death.killer ? (
                          <span className="text-muted-foreground">
                            {death.ability ?? "killed"}
                            {death.killer && ` from ${death.killer}`}
                          </span>
                        ) : (
                          <span
                            className="text-muted-foreground/60"
                            title="This report predates the killing blow being kept — re-import to fill it in"
                          >
                            cause not recorded
                          </span>
                        )}
                        {death.recap && death.recap.length > 0 && <Recap hits={death.recap} />}
                      </li>
                    );
                  })}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Deaths across the pull, in tenths of each pull's own length.
 *
 * Tenths rather than a clock because a wipe is short by definition — on a raw
 * clock every wipe's deaths pile up near the start and the raid reads as dying
 * early when it actually died and the pull ended.
 */
function TenthBars({ byTenth }: { byTenth: number[] }) {
  const peak = Math.max(1, ...byTenth);
  return (
    <div>
      <div className="flex items-end gap-0.5" style={{ height: 44 }}>
        {byTenth.map((n, i) => (
          <span
            key={i}
            className={cn(
              "flex-1 rounded-t-sm",
              n === 0 ? "bg-muted" : "bg-destructive/70",
            )}
            style={{ height: `${Math.max(3, (n / peak) * 100)}%` }}
            title={`${n} death${n === 1 ? "" : "s"} in the ${ordinal(i + 1)} tenth of the pull`}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>pull</span>
        <span>each bar is a tenth of the pull</span>
        <span>end</span>
      </div>
    </div>
  );
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

function formatMs(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
