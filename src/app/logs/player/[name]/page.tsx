import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { format, parseISO } from "date-fns";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { getRepo } from "@/lib/data/repo";
import { CLASS_TEXT_COLORS, WOW_CLASSES, type WowClass } from "@/lib/constants/wow";
import { isGuildScope, raidScopeLabel } from "@/lib/analysis/raid-scope";
import { guessRole } from "@/lib/wcl/roles";
import type { PerformanceReportView } from "@/lib/types";
import { PerformanceBody } from "@/components/performance/performance-body";
import { logPlayerHref } from "@/components/logs/log-player-url";
import { SpecBadge } from "@/components/spec-badge";
import { PageHeader } from "@/components/page-header";
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
  return { title: `${decoded.charAt(0).toUpperCase() + decoded.slice(1)} · Logged pulls` };
}

/**
 * One logged name's record, on demand — a pug, a one-off's raid leader, a
 * trial's main, anybody a report names.
 *
 * The page exists because the officer's question is "how did that raider
 * actually play" and the only way to ask it was to put them on the roster
 * first. Nothing here is tracked: the URL is the name in the log, the read
 * joins to no character, and closing the tab leaves nothing behind.
 *
 * It is also why every guild figure is missing rather than zeroed. Attendance
 * has no denominator for somebody who was never expected; standing, gold per
 * raid and the loot score are the guild's ledger and this person is not in it.
 * What a log *proves* — parses, what was running at the pull, cooldowns, the
 * gear they wore — is the same fact whoever's raid it was, and that is the
 * whole page. See change-chains §3a.
 */
export default async function LogPlayerPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Search;
}) {
  const access = await pageView("logs.view", { returnTo: "/logs" });
  if (!access.allowed) return <NoAccess reason={access.reason} />;

  const [{ name }, sp] = await Promise.all([params, searchParams]);
  const repo = await getRepo();
  const player = await repo.getLogPlayerPerformance(decodeURIComponent(name));
  if (!player) notFound();
  const { reports, career, scopeByCode, rosterSlug } = player;
  const [items, enchants, guild] = await Promise.all([
    repo.listItems(),
    repo.getEnchantReference(),
    repo.getGuild(),
  ]);
  const itemsById = new Map(items.map((i) => [i.id, i] as const));

  /*
   * The log writes a class as a string, and the colours, icons and enchant
   * reference are keyed by the nine we know. An unrecognised one is left off
   * rather than guessed — the page still reads, minus its chips.
   */
  const wowClass: WowClass | undefined = WOW_CLASSES.find(
    (c) => c.toLowerCase() === player.wowClass?.toLowerCase(),
  );
  const spec = career?.spec;
  const role = wowClass ? guessRole(player.role, wowClass, spec) : undefined;

  const requested = Array.isArray(sp.report) ? sp.report[0] : sp.report;
  const active: PerformanceReportView | undefined =
    reports.find((r) => r.report.code === requested) ?? reports[0];
  const guildNights = reports.filter((r) => isGuildScope(scopeByCode[r.report.code])).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title={
          <span className="flex flex-wrap items-baseline gap-2">
            <span style={wowClass ? { color: CLASS_TEXT_COLORS[wowClass] } : undefined}>
              {player.name}
            </span>
            <span className="text-base font-normal text-muted-foreground">Logged pulls</span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            {wowClass && <ClassBadge wowClass={wowClass} />}
            {wowClass && spec && (
              <SpecBadge
                spec={spec}
                wowClass={wowClass}
                title="Spec from their logged pulls"
                className="text-sm"
              />
            )}
            {role && <RoleBadge role={role} />}
            {career && (
              <span className="text-xs">
                {career.fights} pulls over {reports.length} report{reports.length === 1 ? "" : "s"} ·
                median parse <ParseBadge pct={career.medianParse} /> · best{" "}
                <ParseBadge pct={career.bestParse} />
              </span>
            )}
          </span>
        }
      >
        <Button asChild variant="outline" size="sm">
          <Link href="/logs">
            <ArrowLeft className="h-3.5 w-3.5" /> Raid logs
          </Link>
        </Button>
      </PageHeader>

      {/*
        Said once, at the top, in the language an officer would use in council:
        this is a look, not a record. Without it the page is a raider profile
        with some cards missing, and somebody would eventually quote a number
        off it as though it sat beside the roster's.
      */}
      <div className="rounded-xl border bg-card/40 p-3 text-xs text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">Not tracked.</span> Everything here is read
          straight from the imported reports under this name. It counts towards nothing — no
          attendance, no gold per raid, no standing, no loot score — and nothing was created to
          show it.{" "}
          {rosterSlug ? (
            <>
              This name <span className="font-medium text-foreground">is</span> on the roster, so
              the guild&apos;s own record of them —{" "}
              <Link
                href={`/characters/${encodeURIComponent(rosterSlug)}/performance`}
                className="font-medium text-foreground underline underline-offset-2"
              >
                their performance page
              </Link>{" "}
              — is the one to read for anything that counts. This page differs from it only by
              including nights filed as a one-off or a pug.
            </>
          ) : (
            <>
              To make a raider like this count — attendance, loot, the lot — track them on the{" "}
              <Link
                href="/roster"
                className="font-medium text-foreground underline underline-offset-2"
              >
                roster
              </Link>
              .
            </>
          )}
        </p>
      </div>

      {!active ? (
        <EmptyState
          title={`Nothing to read for ${player.name}`}
          description="Every pull under this name was excused on its raid page, so there is no figure left to show."
          action={
            <Button asChild size="sm">
              <Link href="/logs">Back to the raid logs</Link>
            </Button>
          }
        />
      ) : (
        <>
          {/*
            One pill per night, labelled with whose raid it was. The scope sits
            on the pill rather than in a heading because the point of this page
            is that the three kinds are one record — this raider's — and
            splitting them into sections would ask the reader to hold two lists
            in their head to answer "how do they play".
          */}
          {reports.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {reports.map(({ report }) => {
                const isActive = report.code === active.report.code;
                const scope = scopeByCode[report.code];
                return (
                  <Link
                    key={report.code}
                    href={logPlayerHref(player.name, report.code)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-accent",
                      isActive &&
                        "border-foreground/30 bg-primary text-primary-foreground hover:bg-primary",
                    )}
                  >
                    {format(parseISO(report.startTime), "d MMM")} · {report.zone ?? report.title}
                    {scope && !isGuildScope(scope) && (
                      <span className={cn("text-[10px]", !isActive && "text-muted-foreground")}>
                        {raidScopeLabel(scope)}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          )}

          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <Badge variant={isGuildScope(scopeByCode[active.report.code]) ? "secondary" : "warning"}>
              {raidScopeLabel(scopeByCode[active.report.code] ?? "guild")} night
            </Badge>
            {guildNights > 0 && (
              <span>
                {guildNights} of these {reports.length} nights{" "}
                {guildNights === 1 ? "is" : "are"} the guild&apos;s own — those pulls already count
                for whoever on the roster was on them.
              </span>
            )}
            <a
              href={`https://classic.warcraftlogs.com/reports/${encodeURIComponent(active.report.code)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
            >
              open this report on Warcraft Logs <ExternalLink className="h-3 w-3" />
            </a>
          </p>

          <PerformanceBody
            subject="logged"
            subjectName={player.name}
            /*
             * A class the roster doesn't recognise still has pulls worth
             * reading, so the body falls back rather than refusing: Warrior's
             * cooldown list simply matches nothing and the enchant audit grades
             * against the phase guide alone. The missing chips above are the
             * honest signal that we could not place them.
             */
            wowClass={wowClass ?? "Warrior"}
            role={role ?? "Melee DPS"}
            active={active}
            itemsById={itemsById}
            enchants={enchants}
            /* No roster row means no wishlists — nothing to grade "BiS" against. */
            ownWishlists={[]}
            activePhase={guild.activePhase}
          />
        </>
      )}
    </div>
  );
}
