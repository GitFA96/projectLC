import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { format, parseISO } from "date-fns";
import { ArrowLeft, FlaskConical } from "lucide-react";
import { getRepo } from "@/lib/data/repo";
import { AttendanceDetail } from "@/components/performance/attendance-detail";
import { CLASS_TEXT_COLORS } from "@/lib/constants/wow";
import type { PerformanceReportView } from "@/lib/types";
import { PerformanceBody } from "@/components/performance/performance-body";
import { AttendanceWeeks } from "@/components/performance/attendance-weeks";
import { SpecBadge } from "@/components/spec-badge";
import { WeekDots } from "@/components/week-dots";
import { PageHeader } from "@/components/page-header";
import { DevelopmentCard } from "@/components/development-card";
import { ClassBadge } from "@/components/class-badge";
import { RoleBadge } from "@/components/role-badge";
import { EmptyState } from "@/components/empty-state";
import { ParseBadge } from "@/components/parse-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { pageView } from "@/lib/auth/view";
import { NoAccess } from "@/components/no-access";

type Params = { name: string };
type Search = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  return { title: `${decoded.charAt(0).toUpperCase() + decoded.slice(1)} · Performance` };
}

export default async function PerformancePage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Search;
}) {
  const access = await pageView("logs.view", { returnTo: "/roster" });
  if (!access.allowed) return <NoAccess reason={access.reason} />;

  const [{ name }, sp] = await Promise.all([params, searchParams]);
  const repo = await getRepo();
  const perf = await repo.getCharacterPerformance(decodeURIComponent(name));
  if (!perf) notFound();
  const { character, reports, career, attendance } = perf;
  const [items, enchants, bundle, guild, development] = await Promise.all([
    repo.listItems(),
    repo.getEnchantReference(),
    repo.getCharacterBundle(decodeURIComponent(name)),
    repo.getGuild(),
    repo.getDevelopment(character.id),
  ]);
  const itemsById = new Map(items.map((i) => [i.id, i] as const));
  // Their own lists, active phase first — the enchant grading's first choice.
  const ownWishlists = (bundle?.wishlists ?? []).map((w) => w.set);

  const requested = Array.isArray(sp.report) ? sp.report[0] : sp.report;
  const active: PerformanceReportView | undefined =
    reports.find((r) => r.report.code === requested) ?? reports[0];

  return (
    <div className="space-y-5">
      <PageHeader
        title={
          <span className="flex flex-wrap items-baseline gap-2">
            <span style={{ color: CLASS_TEXT_COLORS[character.class] }}>{character.name}</span>
            <span className="text-base font-normal text-muted-foreground">Performance</span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <ClassBadge wowClass={character.class} />
            <SpecBadge
              spec={career?.spec ?? character.spec}
              wowClass={character.class}
              title={career?.spec ? "Spec from their logged pulls" : "Roster spec (no logged spec yet)"}
              className="text-sm"
            />
            <RoleBadge role={character.role} />
            {career && (
              <span className="text-xs">
                {career.fights} pulls over {reports.length} report{reports.length === 1 ? "" : "s"} ·
                career median parse <ParseBadge pct={career.medianParse} /> · best{" "}
                <ParseBadge pct={career.bestParse} />
              </span>
            )}
            {attendance && attendance.raidsAttended > 0 && (
              <>
                <AttendanceDetail attendance={attendance}>
                  <span className="flex items-center gap-1.5">
                    {/* The guild's own figure, so the headline and the loot
                        sheet can never show different attendance. */}
                    <Badge
                      variant={
                        attendance.scorePct !== undefined && attendance.scorePct < 50
                          ? "warning"
                          : "secondary"
                      }
                    >
                      raided {attendance.scoreAttended}/{attendance.scoreTracked}{" "}
                      {attendance.scoreBasis === "week" ? "reset weeks" : "logged raids"}
                    </Badge>
                    <WeekDots weeks={attendance.weeks} />
                  </span>
                </AttendanceDetail>
              </>
            )}
          </span>
        }
      >
        {/*
          The sim lives in its own section now, keyed by class and spec rather
          than by raider — this is a shortcut into it with this raider already
          chosen. Their logged spec wins over the roster's: the sim compares
          against pulls, and a pull is whatever they actually played.
        */}
        {(career?.spec ?? character.spec) && (
          <Button asChild variant="outline" size="sm">
            <Link
              href={`/sim/${encodeURIComponent(character.class)}/${encodeURIComponent(
                career?.spec ?? character.spec!,
              )}?player=${encodeURIComponent(character.name)}`}
            >
              <FlaskConical className="h-3.5 w-3.5" /> Sim
            </Link>
          </Button>
        )}
        <Button asChild variant="outline" size="sm">
          <Link href={`/characters/${encodeURIComponent(character.name.toLowerCase())}`}>
            <ArrowLeft className="h-3.5 w-3.5" /> Profile
          </Link>
        </Button>
      </PageHeader>

      {!active ? (
        <EmptyState
          title={`No Warcraft Logs data for ${character.name} yet`}
          description="Import a report on the Warcraft Logs tab of the import page — every raider in the log gets their pulls, parses and consumable usage recorded."
          action={
            <Button asChild size="sm">
              <Link href="/guild/import?tab=wcl">Import a report</Link>
            </Button>
          }
        />
      ) : (
        <>
          {/* Career shape first: which way they are going frames every number
              beneath it, and no rollup on this page can say. */}
          <DevelopmentCard
            series={development}
            characterSlug={character.name.toLowerCase()}
            activeCode={active.report.code}
          />

          {reports.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {reports.map(({ report }) => {
                const isActive = report.code === active.report.code;
                return (
                  <Link
                    key={report.code}
                    href={`/characters/${encodeURIComponent(character.name.toLowerCase())}/performance?report=${encodeURIComponent(report.code)}`}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-accent",
                      isActive && "border-foreground/30 bg-primary text-primary-foreground hover:bg-primary",
                    )}
                  >
                    {format(parseISO(report.startTime), "d MMM")} · {report.zone ?? report.title}
                  </Link>
                );
              })}
            </div>
          )}

          <PerformanceBody
            subject="roster"
            subjectName={character.name}
            wowClass={character.class}
            role={character.role}
            active={active}
            itemsById={itemsById}
            enchants={enchants}
            ownWishlists={ownWishlists}
            activePhase={guild.activePhase}
            attendanceWeeks={
              attendance && attendance.weeks.length > 0 ? (
                <AttendanceWeeks characterId={character.id} attendance={attendance} />
              ) : undefined
            }
          />
        </>
      )}
    </div>
  );
}
