"use client";

import * as React from "react";
import { format, parseISO } from "date-fns";
import { ChevronRight } from "lucide-react";
import { lootPriorityTitle } from "@/lib/analysis/loot-priority";
import { AwardItemButton } from "@/components/award-item-controls";
import { CharacterLink, ClassBadge } from "@/components/class-badge";
import { ItemLink, type ItemRef } from "@/components/item-link";
import { ParseBadge } from "@/components/parse-badge";
import { RoleBadge } from "@/components/role-badge";
import { WeekDots } from "@/components/week-dots";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AwardTarget } from "@/lib/loot/award-context";
import type {
  AttendanceSummary,
  CharacterStatus,
  ContenderAward,
  LootPriority,
  PerformanceSummary,
  Phase,
  Role,
  WowClass,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The loot council's decision table: who wants the item, in priority order,
 * and — one click down — what each score was actually built from.
 *
 * The columns are for scanning; the drawer is for arguing. Officers get
 * challenged on exactly three things ("his attendance isn't really that good",
 * "she only parses low because her gear is bad", "he never flasks"), so each
 * scored factor opens into the handful of numbers that answer that challenge
 * — recent form next to career attendance, the gear-adjusted percentile next
 * to the raw parse, flask and food separately next to the combined figure.
 *
 * Every drawer marks which single row IS the number the score used, so nobody
 * has to guess which of five percentages the weight was applied to.
 */

export interface ContenderView {
  characterId: string;
  name: string;
  wowClass: WowClass;
  spec: string;
  role: Role;
  status: CharacterStatus;
  /** 1-based among the unsatisfied contenders; absent once satisfied. */
  rank?: number;
  satisfied: boolean;
  /** Phases they wishlisted the item for. */
  phases: Phase[];
  /** Rung of the council's chain they sit on — 0 is the top. */
  priorityTier?: number;
  priorityTierLabel?: string;
  priority?: LootPriority;
  onSpecAwardsActivePhase: number;
  /** Everything handed to them this phase, newest first — the loot panel's evidence. */
  awardsThisPhase: ContenderAward[];
  totalOnSpecAwards: number;
  attendance?: AttendanceSummary;
  career?: PerformanceSummary;
  /** ≈ gold per raid on consumables — shown, never scored. */
  goldPerRaid?: number;
  /** What they run in the item's slot family today. */
  currentInSlot: ItemRef[];
}

const COLUMNS = 9;

/** The "they already got a belt this phase" markdown, when one applies. */
const slotServed = (c: ContenderView) =>
  c.priority?.adjustments.find((a) => a.key === "slotServed");
/** The alt/pug/inactive markdown, when their standing isn't plain "main". */
const standing = (c: ContenderView) =>
  c.priority?.adjustments.find((a) => a.key === "standing");

export function PriorityScore({ priority }: { priority?: LootPriority }) {
  const score = priority?.score;
  if (score === undefined) {
    return (
      <span className="text-xs text-muted-foreground/50" title="Nothing logged for them yet">
        no data
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2" title={priority ? lootPriorityTitle(priority) : undefined}>
      <span className="w-8 shrink-0 text-sm font-semibold tabular-nums">{score}</span>
      <Progress
        value={score}
        className="h-1.5 w-16"
        indicatorClassName={
          score >= 70 ? "bg-emerald-500" : score >= 45 ? "bg-amber-500" : "bg-muted-foreground/40"
        }
      />
    </span>
  );
}

/** A metric column: the number, or a visibly absent one — never a fabricated 0. */
function Metric({ value, suffix = "", title }: { value?: number; suffix?: string; title?: string }) {
  if (value === undefined) {
    return (
      <span className="text-xs text-muted-foreground/50" title="Not logged yet — left out of the score">
        —
      </span>
    );
  }
  return (
    <span className="text-sm tabular-nums" title={title}>
      {value}
      {suffix}
    </span>
  );
}

interface StatRow {
  label: string;
  value: React.ReactNode;
  /** This is the number the weight was applied to. */
  scored?: boolean;
  title?: string;
}

function Panel({
  title,
  weight,
  score,
  rows,
  note,
  empty,
}: {
  title: string;
  weight: number;
  score?: number;
  rows: StatRow[];
  note?: string;
  empty?: string;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-baseline gap-2 border-b pb-1">
        <span className="text-xs font-semibold uppercase tracking-wide">{title}</span>
        <span className="text-[11px] tabular-nums text-muted-foreground">{weight}% of the score</span>
        <span className="ml-auto text-sm font-semibold tabular-nums">
          {score ?? <span className="text-xs font-normal text-muted-foreground/60">not counted</span>}
        </span>
      </div>
      {empty ? (
        <p className="py-1 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <dl className="space-y-0.5">
          {rows.map((row) => (
            <div
              key={row.label}
              className={cn(
                "flex items-center justify-between gap-3 text-xs",
                row.scored && "font-medium text-foreground",
                !row.scored && "text-muted-foreground",
              )}
              title={row.title}
            >
              <dt className="min-w-0 truncate">
                {row.label}
                {row.scored && <span className="ml-1 text-[10px] text-emerald-600">◂ scored</span>}
              </dt>
              <dd className="shrink-0 tabular-nums">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {note && <p className="pt-0.5 text-[11px] text-muted-foreground/80">{note}</p>}
    </div>
  );
}

function attendanceRows(a: AttendanceSummary): StatRow[] {
  const rows: StatRow[] = [
    {
      label: "Logged raids attended",
      value: `${a.raidsAttended} / ${a.raidsTracked}`,
      scored: true,
      title: "Raids since their first logged appearance — the fraction the score uses",
    },
    {
      label: "Reset weeks raided",
      value: (
        <span className="flex items-center gap-1.5">
          <WeekDots weeks={a.weeks} />
          {a.weeksAttended} / {a.weeksTracked}
        </span>
      ),
      title: "Did they raid at all that week? Newest on the right",
    },
    {
      // The staleness check: a strong career number can hide a fading raider.
      label: `Last ${a.recentTotal} raids`,
      value: `${a.recentAttended} / ${a.recentTotal}`,
      title: "Recent form — how the career number is trending",
    },
    {
      label: "Boss pulls when present",
      value: `${a.pullPct}%`,
      title: "Late joins and early leaves show up here, not in the raid count",
    },
  ];
  if (a.weeksExcused > 0) {
    rows.push({
      label: "Excused weeks",
      value: a.weeksExcused,
      title: "Officer-marked absences — not counted either way",
    });
  }
  return rows;
}

function performanceRows(c: PerformanceSummary): StatRow[] {
  return [
    {
      label: "Median parse",
      value: <ParseBadge pct={c.medianParse} />,
      scored: true,
      title: "Median percentile across every logged pull",
    },
    // The standard rebuttal to a low parse, and often a fair one — but only
    // worth a line when the import actually carried bracket percentiles.
    ...(c.medianBracket === undefined
      ? []
      : [
          {
            label: "Gear-adjusted (bracket)",
            value: <ParseBadge pct={c.medianBracket} />,
            title:
              "Percentile within their item-level bracket: how they do for the gear they have",
          },
        ]),
    { label: "Best parse", value: <ParseBadge pct={c.bestParse} /> },
    {
      label: "Kills / pulls",
      value: `${c.kills} / ${c.fights}`,
      title: "How much of this is actually measured",
    },
    {
      label: "Deaths per pull",
      value: c.fights > 0 ? (c.deaths / c.fights).toFixed(2) : "—",
      title: "A dead raider parses nothing and costs a battle rez",
    },
  ];
}

function preparationRows(c: PerformanceSummary, goldPerRaid?: number): StatRow[] {
  return [
    { label: "Flask or elixir", value: `${c.flaskOrElixirsPct}%` },
    { label: "Food", value: `${c.foodPct}%` },
    {
      label: "Both, per pull",
      value: `${c.preparedPct}%`,
      scored: true,
      title: "Flask-or-elixir AND food up at the pull — the number the score uses",
    },
    { label: "Weapon buff", value: `${c.weaponBuffPct}%`, title: "Oil, stone, poison or imbue" },
    {
      label: "Pre-pots / potions per pull",
      value: `${c.prepots} / ${c.potionsPerFight}`,
      title: "Potion discipline — not scored, but it's the same habit",
    },
    {
      // Percentages say whether they showed up prepared; gold says what that
      // habit costs them a night. A raider spending 300g a raid is buying the
      // guild's kills out of their own pocket.
      label: "≈ gold per raid",
      value:
        goldPerRaid === undefined ? (
          <span className="text-muted-foreground/50">—</span>
        ) : (
          `${Math.round(goldPerRaid).toLocaleString("en-US")}g`
        ),
      title:
        "Consumables bought per raid night at default prices — prep buffs plus in-fight items. Not scored.",
    },
    {
      label: "Missing enchants",
      value:
        c.missingEnchants.length === 0 ? (
          <span className="text-emerald-600">none</span>
        ) : (
          <span className="text-red-600">{c.missingEnchants.join(", ")}</span>
        ),
      title: "Unenchanted slots on their most recent pull — not scored, but hard to ignore",
    },
  ];
}

/**
 * What they've already been handed. The scored number is just a count, so the
 * panel's job is to say what those items WERE — six pieces spread over six
 * slots is a different argument from three belts, and the count can't tell
 * them apart.
 */
function lootRows(c: ContenderView, activePhase: Phase): StatRow[] {
  const onSpec = c.awardsThisPhase.filter((a) => !a.offspec);
  const offSpec = c.awardsThisPhase.filter((a) => a.offspec);
  const sameSlot = onSpec.filter((a) => a.sameSlot);
  const last = c.awardsThisPhase[0];

  const rows: StatRow[] = [
    {
      label: `On-spec items, P${activePhase}`,
      value: onSpec.length,
      scored: true,
      title: "Measured against whoever in this contest has taken the most",
    },
    { label: "Off-spec items", value: offSpec.length, title: "Shown, but never scored against them" },
    {
      label: "On-spec, all phases",
      value: c.totalOnSpecAwards,
      title: "The long view — a quiet phase after a rich one still reads as quiet",
    },
    {
      label: "Last item won",
      value: last ? (
        <span title={`${last.itemName} — ${format(parseISO(last.awardedAt), "d MMM yyyy")}`}>
          {format(parseISO(last.awardedAt), "d MMM")}
        </span>
      ) : (
        <span className="text-muted-foreground/50">never</span>
      ),
      title: last ? last.itemName : undefined,
    },
  ];
  if (sameSlot.length > 0) {
    rows.push({
      label: "Won for THIS slot",
      value: (
        <span className="text-amber-700" title={sameSlot.map((a) => a.itemName).join(", ")}>
          {sameSlot.length}
        </span>
      ),
      title: `Already filled this slot this phase: ${sameSlot.map((a) => a.itemName).join(", ")}`,
    });
  }
  return rows;
}

function ContenderDetail({
  contender,
  activePhase,
}: {
  contender: ContenderView;
  activePhase: Phase;
}) {
  const factor = (key: string) => contender.priority?.factors.find((f) => f.key === key);
  const { attendance, career } = contender;
  const adjustments = contender.priority?.adjustments ?? [];

  return (
    <div className="grid gap-x-8 gap-y-4 rounded-lg bg-muted/40 p-3 md:grid-cols-2 xl:grid-cols-4">
      <Panel
        title="Attendance"
        weight={factor("attendance")?.weight ?? 0}
        score={factor("attendance")?.score}
        rows={attendance && attendance.raidsTracked > 0 ? attendanceRows(attendance) : []}
        empty={
          attendance && attendance.raidsTracked > 0
            ? undefined
            : "Never seen in a logged raid — attendance is left out of the score entirely."
        }
      />
      <Panel
        title="Loot owed"
        weight={factor("lootDebt")?.weight ?? 0}
        score={factor("lootDebt")?.score}
        rows={lootRows(contender, activePhase)}
      />
      <Panel
        title="Performance"
        weight={factor("performance")?.weight ?? 0}
        score={factor("performance")?.score}
        rows={career ? performanceRows(career) : []}
        empty={career ? undefined : "No logged pulls — performance is left out of the score."}
        note={career?.spec ? `Logged as ${career.spec} (${career.role})` : undefined}
      />
      <Panel
        title="Preparation"
        weight={factor("preparation")?.weight ?? 0}
        score={factor("preparation")?.score}
        rows={career ? preparationRows(career, contender.goldPerRaid) : []}
        empty={career ? undefined : "No logged pulls — preparation is left out of the score."}
      />
      {adjustments.length > 0 && (
        <p className="text-[11px] text-muted-foreground xl:col-span-4">
          Weighted score then multiplied by{" "}
          {adjustments.map((a, i) => (
            <span key={a.key}>
              {i > 0 && " and "}
              <span className="font-medium text-foreground">×{a.multiplier}</span> ({a.note})
            </span>
          ))}
          .
        </p>
      )}
    </div>
  );
}

export function ContenderTable({
  contenders,
  awardTarget,
  prefill,
  activePhase,
  hasChain = false,
}: {
  contenders: ContenderView[];
  /** The raid nights an award lands in — shared, the winner is stamped on at click. */
  awardTarget: AwardTarget;
  /** The contested item, prefilled into the award dialog. */
  prefill: ItemRef;
  activePhase: Phase;
  /** The sheet has a chain for this item — so "off sheet" means something. */
  hasChain?: boolean;
}) {
  const [open, setOpen] = React.useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8">#</TableHead>
          <TableHead>Character</TableHead>
          <TableHead className="w-32">Priority</TableHead>
          <TableHead className="w-24 text-right">Attendance</TableHead>
          <TableHead className="w-20 text-right">Loot (P{activePhase})</TableHead>
          <TableHead className="w-16 text-right">Parse</TableHead>
          <TableHead className="w-16 text-right">Prep</TableHead>
          <TableHead>Currently using</TableHead>
          <TableHead className="w-24" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {contenders.map((c) => {
          const expanded = open.has(c.characterId);
          return (
            <React.Fragment key={c.characterId}>
              <TableRow className={cn(c.satisfied && "opacity-55", expanded && "border-b-0")}>
                <TableCell className="text-sm font-semibold tabular-nums text-muted-foreground">
                  {c.rank ?? "—"}
                </TableCell>
                <TableCell>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => toggle(c.characterId)}
                      aria-expanded={expanded}
                      className="-ml-1 shrink-0 cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      title={`${expanded ? "Hide" : "Show"} what ${c.name}'s score is built from`}
                    >
                      <ChevronRight
                        className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")}
                      />
                    </button>
                    <CharacterLink name={c.name} wowClass={c.wowClass} />
                    <ClassBadge wowClass={c.wowClass} spec={c.spec} />
                    <RoleBadge role={c.role} />
                    {/* The sheet's verdict leads the metrics, so it reads first. */}
                    {c.priorityTierLabel !== undefined ? (
                      <Badge
                        variant={c.priorityTier === 0 ? "success" : "secondary"}
                        className="font-normal"
                        title={`Priority ${(c.priorityTier ?? 0) + 1} on the guild's sheet for this item`}
                      >
                        #{(c.priorityTier ?? 0) + 1} {c.priorityTierLabel}
                      </Badge>
                    ) : (
                      hasChain && (
                        <Badge
                          variant="muted"
                          className="font-normal"
                          title="The sheet's chain doesn't name their spec — they sort below everyone it does"
                        >
                          off sheet
                        </Badge>
                      )
                    )}
                    {standing(c) && (
                      <Badge variant="muted" title={standing(c)!.note}>
                        {c.status}
                      </Badge>
                    )}
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      wants for {c.phases.map((p) => `P${p}`).join(", ")}
                    </span>
                  </span>
                </TableCell>
                <TableCell>
                  {c.satisfied ? (
                    <Badge variant="success" title="Already equipped, or won on-spec">
                      Satisfied
                    </Badge>
                  ) : (
                    <span className="flex flex-col items-start gap-0.5">
                      <PriorityScore priority={c.priority} />
                      {slotServed(c) && (
                        <Badge
                          variant="warning"
                          className="px-1 py-0 text-[10px] font-normal"
                          title={slotServed(c)!.note}
                        >
                          slot served ×{slotServed(c)!.multiplier}
                        </Badge>
                      )}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Metric
                    value={
                      c.attendance && c.attendance.raidsTracked > 0 ? c.attendance.raidPct : undefined
                    }
                    suffix="%"
                    title={
                      c.attendance
                        ? `${c.attendance.raidsAttended} of ${c.attendance.raidsTracked} logged raids`
                        : undefined
                    }
                  />
                </TableCell>
                <TableCell className="text-right">
                  <span className="text-sm tabular-nums" title="On-spec items won this phase">
                    {c.onSpecAwardsActivePhase}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <Metric value={c.career?.medianParse} title="Median parse percentile" />
                </TableCell>
                <TableCell className="text-right">
                  <Metric
                    value={c.career?.preparedPct}
                    suffix="%"
                    title="Pulls opened with flask-or-elixir AND food"
                  />
                </TableCell>
                <TableCell>
                  {c.currentInSlot.length > 0 ? (
                    <span className="flex flex-wrap gap-x-3 gap-y-1">
                      {c.currentInSlot.map((item) => (
                        <ItemLink key={item.itemId} item={item} size="sm" className="opacity-75" />
                      ))}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground/50">empty slot</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {!c.satisfied && (
                    // The dialog names the winner in its title — that's the
                    // confirmation step, so the row button stays short.
                    <AwardItemButton
                      ctx={{ ...awardTarget, characterId: c.characterId, characterName: c.name }}
                      prefill={prefill}
                    />
                  )}
                </TableCell>
              </TableRow>
              {expanded && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={COLUMNS} className="pt-0">
                    <ContenderDetail contender={c} activePhase={activePhase} />
                  </TableCell>
                </TableRow>
              )}
            </React.Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}
