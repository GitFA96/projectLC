import { CharacterLink } from "@/components/class-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { BossDeathProfile } from "@/lib/analysis/deaths";
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
 * **It names no cause.** The app doesn't know what killed anybody — that would
 * need ability-level events it never fetches, and reading "died to Flame
 * Wreath" off a clock would be an invention. When, who, how consistently; the
 * officer who was there supplies the rest.
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
          </CardContent>
        </Card>
      ))}
    </div>
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
