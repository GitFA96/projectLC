import Link from "next/link";
import { CharacterLink } from "@/components/class-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  STANDING_BAND_LABELS,
  type StandingBoard,
  type StandingKpi,
  type StandingRow,
} from "@/lib/analysis/standing";
import type { WowClass } from "@/lib/constants/wow";
import { cn } from "@/lib/utils";

export interface StandingBoardRow extends StandingRow {
  wowClass: WowClass;
  spec: string;
}

/**
 * The roster ranked against itself, weakest first.
 *
 * Every figure is a placing inside this guild rather than a score against a
 * threshold, because a threshold is a judgement the app has no standing to make
 * and a placing is a fact. "Third from bottom of nineteen on preparation" is
 * something an officer can say out loud and defend; "below 80%" is an argument
 * about the number.
 *
 * The distributions above the table are the instrument for reading it: a KPI
 * where the whole roster sits within a few points is separating nobody, and the
 * board says so with the spread rather than by hiding the column.
 */
export function StandingBoardView({
  board,
  weights,
  minRaids,
  weightsSet,
  title,
  subtitle,
}: {
  board: Omit<StandingBoard, "rows"> & { rows: StandingBoardRow[] };
  weights: Record<"attendance" | "performance" | "preparation", number>;
  minRaids: number;
  /** Whether the council has set the weighting, or it is still the placeholder. */
  weightsSet: boolean;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        {board.distributions.map((d) => (
          <Card key={d.key}>
            <CardContent className="p-4">
              <p className="text-xs font-medium text-muted-foreground">{d.label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
                {d.median === undefined ? "—" : `${d.median}%`}
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">median</span>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {d.measured === 0 ? (
                  "nobody measured"
                ) : (
                  <>
                    {d.min}% – {d.max}% across {d.measured} placed raider
                    {d.measured === 1 ? "" : "s"}
                    {d.missing > 0 && `, ${d.missing} with no figure`}
                  </>
                )}
              </p>
              {d.spread !== undefined && d.measured > 1 && (
                <p className="mt-1 text-[11px] text-muted-foreground/80">
                  {d.spread} points between top and bottom — the narrower this is, the less this
                  column is telling you.
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {!weightsSet && (
        <div className="rounded-xl border border-warn-line bg-warn-soft p-3 text-sm text-warn-ink">
          <span className="font-medium">The weighting is still the placeholder.</span> The three
          columns count equally because the app has no opinion about whether turning up matters
          more than parsing — that is the council&apos;s call, and until it is made this board is a
          draft. Set it{" "}
          <Link href="/" className="font-medium underline underline-offset-2">
            on the guild page
          </Link>
          .
        </div>
      )}

      <Card>
        <CardHeader className="space-y-2">
          <CardTitle className="flex flex-wrap items-baseline gap-2">
            {title}
            <span className="text-xs font-normal text-muted-foreground">
              {board.pool} placed
              {board.unplaced > 0 && `, ${board.unplaced} too new to place`}
            </span>
          </CardTitle>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
          <p className="text-xs text-muted-foreground">
            Each raider&apos;s placing among the guild&apos;s own raiders — 100 is the top of this
            roster, not a perfect score. Weighted {weights.attendance} attendance /{" "}
            {weights.performance} parse / {weights.preparation} preparation, and a KPI nobody has a
            figure for drops out rather than counting as zero.{" "}
            <strong>Loot owed is deliberately absent</strong> — being owed loot is not a demerit.
            Trend is the recent nights&apos; parse against everything earlier, shown and never
            scored: where somebody is and where they are heading are different questions.
            Fewer than {minRaids} logged raids and a raider is listed but not placed.
          </p>
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Reading it:</span> 50 is the middle of
            this group, 100 its top, 0 its bottom — nobody scores 100 by being good, only by being
            first. So a low number means &ldquo;behind the others here&rdquo;, never &ldquo;bad&rdquo;:
            the bottom quarter of a strong roster may be playing perfectly well, and whether it
            matters is your call, not the number&apos;s. Read it next to <strong>Trend</strong> —
            somebody last and climbing is a different conversation from somebody last and sliding.
          </p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 text-right">#</TableHead>
                <TableHead>Raider</TableHead>
                <TableHead className="w-24 text-right">Standing</TableHead>
                <TableHead className="w-24 text-right">Trend</TableHead>
                {board.distributions.map((d) => (
                  <TableHead key={d.key} className="w-36 text-right">
                    {d.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {board.rows.map((row, i) => (
                <TableRow key={row.characterId}>
                  <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                    {row.standing === undefined ? "—" : i + 1}
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-2">
                      <CharacterLink name={row.name} wowClass={row.wowClass} />
                      <span className="text-xs text-muted-foreground">{row.spec}</span>
                      {row.status !== "main" && (
                        <Badge variant="muted" className="font-normal">
                          {row.status}
                        </Badge>
                      )}
                      {row.measured > 0 && row.measured < board.distributions.length && (
                        <Badge
                          variant="muted"
                          className="font-normal"
                          title="Placed on fewer KPIs than the rest — not directly comparable"
                        >
                          {row.measured} of {board.distributions.length} measured
                        </Badge>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    {row.standing === undefined ? (
                      <span className="text-xs text-muted-foreground">{row.unranked}</span>
                    ) : (
                      <span className="flex flex-col items-end">
                        <span
                          className={cn(
                            "text-sm font-semibold tabular-nums",
                            row.band === "bottom" && "text-destructive",
                            row.band === "top" && "text-success-ink",
                          )}
                          title="Weighted mean of their placings on the columns they have"
                        >
                          {row.standing}
                        </span>
                        {row.band && (
                          <span className="text-[11px] text-muted-foreground">
                            {STANDING_BAND_LABELS[row.band]}
                          </span>
                        )}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <TrendCell delta={row.parseTrend} />
                  </TableCell>
                  {row.kpis.map((kpi) => (
                    <TableCell key={kpi.key} className="text-right">
                      <KpiCell kpi={kpi} pool={board.pool} recent={row} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Which way their parse is going: the recent window's mean against every night
 * before it, in points.
 *
 * A placing says where somebody is; this says where they are heading, and the
 * two together are the difference between "bench them" and "give them three
 * more weeks". Nothing here calls a number good or bad — that needs a
 * threshold, and the threshold is the council's.
 */
function TrendCell({ delta }: { delta?: number }) {
  if (delta === undefined) {
    return (
      <span
        className="text-xs text-muted-foreground/60"
        title="No earlier nights to compare against — too soon to say, which isn't the same as flat"
      >
        —
      </span>
    );
  }
  const rounded = Math.round(delta);
  return (
    <span
      className={cn(
        "text-sm tabular-nums",
        rounded > 0 && "text-success-ink",
        rounded < 0 && "text-destructive",
        rounded === 0 && "text-muted-foreground",
      )}
      title="Recent nights' median parse against every night before them, in points"
    >
      {rounded > 0 ? `+${rounded}` : rounded}
    </span>
  );
}

/** The raider's own figure, with where it placed beneath it. */
function KpiCell({
  kpi,
  pool,
  recent,
}: {
  kpi: StandingKpi;
  pool: number;
  recent: StandingBoardRow;
}) {
  if (kpi.value === undefined) {
    return (
      <span className="text-xs text-muted-foreground/60" title={kpi.detail}>
        no data
      </span>
    );
  }
  // A drift between all-time and recent attendance is the whole conversation,
  // so it sits next to the number rather than being averaged into it.
  const drift =
    kpi.key === "attendance" &&
    recent.recentAttendancePct !== undefined &&
    Math.abs(recent.recentAttendancePct - kpi.value) >= 15;
  return (
    <span className="flex flex-col items-end" title={kpi.detail}>
      <span className="text-sm tabular-nums">{Math.round(kpi.value)}%</span>
      <span className="text-[11px] tabular-nums text-muted-foreground">
        {kpi.percentile === undefined ? "—" : `${kpi.percentile}th of ${pool}`}
      </span>
      {drift && (
        <span
          className="text-[11px] tabular-nums text-warn-ink"
          title="Recent attendance, over the window on the guild page"
        >
          {recent.recentAttendancePct}% lately
        </span>
      )}
    </span>
  );
}
