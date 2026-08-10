import { format, parseISO } from "date-fns";
import type { DevelopmentSeries } from "@/lib/analysis/development";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * One raider, night by night.
 *
 * Every other number on this page is a career rollup, which is the right shape
 * for ranking and the wrong shape for "is this getting better". A raider on a
 * 55 median who opened the tier at 40 and a raider on a 55 median who opened at
 * 75 look identical everywhere else in the app.
 *
 * The bars are drawn against 0–100 because that is what a percentile already
 * is — no rescaling to make a flat line look dramatic, which is the usual way a
 * chart lies. Nights they missed are absent rather than zero.
 */
export function DevelopmentCard({ series }: { series: DevelopmentSeries }) {
  if (series.nights.length === 0) return null;

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle className="flex flex-wrap items-baseline gap-2">
          Development
          <span className="text-xs font-normal text-muted-foreground">
            {series.nights.length} logged night{series.nights.length === 1 ? "" : "s"}
          </span>
        </CardTitle>
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          {series.trends.map((t) => (
            <p key={t.key} className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{t.label}</span>{" "}
              {t.delta === undefined ? (
                <span title="Nothing earlier to compare against — too soon to say, which isn't the same as flat">
                  not enough history yet
                </span>
              ) : (
                <>
                  <span
                    className={cn(
                      "font-medium tabular-nums",
                      t.delta > 0 && "text-success-ink",
                      t.delta < 0 && "text-destructive",
                    )}
                  >
                    {t.delta > 0 ? `+${t.delta}` : t.delta}
                  </span>{" "}
                  over the last {t.nightsRecent} night{t.nightsRecent === 1 ? "" : "s"} ({t.recent})
                  against the {t.nightsEarlier} before ({t.earlier})
                </>
              )}
            </p>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        {series.nights.map((night) => (
          <div key={night.reportCode} className="flex items-center gap-3 text-xs">
            <span className="w-20 shrink-0 tabular-nums text-muted-foreground">
              {format(parseISO(night.date), "d MMM yy")}
            </span>
            <Bar value={night.medianParse} label="parse" />
            <span className="w-10 shrink-0 text-right tabular-nums">
              {night.medianParse === undefined ? (
                <span className="text-muted-foreground/50">—</span>
              ) : (
                Math.round(night.medianParse)
              )}
            </span>
            <Bar value={night.preparedPct} label="prepared" muted />
            <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">
              {night.preparedPct}%
            </span>
            <span className="w-28 shrink-0 truncate text-muted-foreground/80" title={night.title}>
              {night.zone ?? night.title}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground/70">
              {night.kills}/{night.pulls} kills
              {night.deaths > 0 && ` · ${night.deaths} death${night.deaths === 1 ? "" : "s"}`}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** 0–100 on its own scale, never stretched to make a flat line look like news. */
function Bar({ value, label, muted }: { value?: number; label: string; muted?: boolean }) {
  return (
    <span
      className="h-2 min-w-14 flex-1 overflow-hidden rounded-full bg-muted"
      title={value === undefined ? `no ${label} this night` : `${label} ${Math.round(value)}`}
    >
      {value !== undefined && (
        <span
          className={cn("block h-full rounded-full", muted ? "bg-muted-foreground/40" : "bg-primary")}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      )}
    </span>
  );
}
