import type { Metadata } from "next";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { Users } from "lucide-react";
import {
  archetypePalette,
  decodePlan,
  emptyBoard,
  rosterBoardKey,
  partiesFromLogs,
  poolFromPalette,
  poolFromPullRows,
  poolFromRoster,
  selectBoard,
  withProspects,
  withRosterSpecs,
  type Archetype,
  type PoolMember,
  type GuildRoster,
  type RecoveredParty,
  type RosterMember,
} from "@/lib/analysis/raid-planner";
import { getRepo } from "@/lib/data/repo";
import { SCOPE_LABELS, buffLabel, buffsForClass } from "@/lib/constants/raid-buffs";
import { CLASS_TEXT_COLORS, WOW_CLASSES } from "@/lib/constants/wow";
import type { WowClass } from "@/lib/types";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { RaidBoard } from "@/components/raid-planner/board";
import { RosterTools, NewRosterButton } from "@/components/raid-planner/roster-tools";
import type { BoardTarget } from "@/app/raid-planner/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Raid planner" };

type Search = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * The raid planner, in two tabs and three kinds of board.
 *
 * **Template** designs the shape: classes and specs, as many of each as the
 * raid needs, saved once for the guild. It is deliberately not built from named
 * raiders — a plan pinned to people is stale the moment somebody can't come,
 * and "two shadow priests with the casters" is the decision actually being made.
 *
 * **Guild** is the other half, and it is about named people. Two things live
 * there because both are:
 *
 *  - the guild's own **rosters** — as many as the officers want, because a
 *    guild that runs a split has more than one at a time. Built from the
 *    roster, plus any trials an officer invented to see what recruiting would
 *    fix;
 *  - every **raid night** logged — who really stood where, pooled from the log
 *    with the spec each of them played and the buffs they were caught
 *    providing, saved against that raid alone.
 *
 * Every board moves people identically and every one lets an officer name and
 * add and remove groups. What differs is where slots come from: the template
 * invents archetypes, a guild roster invents trials, and a raid night invents
 * nothing at all — inventing a twenty-sixth raider for a night that fielded
 * twenty-five would make the record a fiction.
 */
export default async function RaidPlannerPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;

  const repo = await getRepo();
  const [characters, reports, boards] = await Promise.all([
    repo.listCharacters(),
    repo.listWclReports(),
    repo.listGuildRosters(),
  ]);

  /*
   * The roster's OWN two specs, not `loggedSpec`. Katzewarr is recorded as
   * Fury / Arms and the logs called him Arms all night — folding the logged
   * answer in here collapses both entries onto "Arms" and the officer never
   * gets offered the other one, which is the whole point of the control.
   */
  const roster: RosterMember[] = characters.map((c) => ({
    name: c.character.name,
    wowClass: c.character.class,
    spec: c.character.spec,
    offSpec: c.character.offSpec,
    role: c.character.role,
    status: c.character.status,
  }));

  const selection = selectBoard(one(sp.board), {
    reportCodes: reports.map((r) => r.report.code),
    rosterIds: boards.map((b) => b.id),
  });

  let pool: PoolMember[] = [];
  let palette: Archetype[] | undefined;
  let poolNote = "";
  let saved = emptyBoard();
  let recovered: RecoveredParty[] = [];
  let target: BoardTarget = { kind: "template" };
  let guildRoster: GuildRoster | undefined;

  const report = reports.find((r) => r.report.code === selection.reportCode);
  if (report) {
    const code = report.report.code;
    const raid = await repo.getRaidReport(code);
    const rows = raid
      ? (await Promise.all(raid.fights.map((f) => repo.listPullRows(code, f.fightId)))).flat()
      : [];
    /*
     * A raid night's board belongs to that raid, so this page edits the very
     * same record the log page does — not a copy, and never something carried
     * over from a guild roster or another night.
     */
    pool = withRosterSpecs(poolFromPullRows(rows), roster);
    saved = await repo.getRaidBoard(code);
    recovered = partiesFromLogs(rows);
    target = { kind: "raid", code };
    poolNote = `${format(parseISO(report.report.startTime), "d MMM yyyy")} · ${
      report.report.zone ?? report.report.title
    } — everyone the log caught on a boss pull. Saved against this raid.`;
  } else if (selection.rosterId) {
    guildRoster = boards.find((b) => b.id === selection.rosterId);
  }

  if (guildRoster) {
    /*
     * A guild roster is the guild's own raiders, plus whoever the officer
     * invented on this board to see what recruiting one would fix. No stored
     * bench: the pool is a finite set of real people, so "everyone not placed"
     * is derivable exactly as it is for a raid night.
     */
    pool = withProspects(poolFromRoster(roster), guildRoster.prospects);
    saved = guildRoster.board;
    target = { kind: "roster", id: guildRoster.id };
    poolNote = `${guildRoster.name} — the guild's raiders, mains and alts. Saved as this roster alone.`;
  } else if (selection.tab === "template") {
    /*
     * The template is built from classes and specs, not people.
     *
     * A board you design before the raid is a shape — "two shadow priests
     * with the casters, a resto shaman per melee group" — and pinning it to
     * named raiders makes it stale the moment somebody can't come. Which is
     * what the guild rosters next door are for.
     */
    palette = archetypePalette(await repo.listSimSpecs());
    pool = poolFromPalette(palette);
    // The template's board is its own record, kept apart from every raid's.
    saved = await repo.getTemplateBoard();
    // Its bench holds actual slots, so an empty one has to be declared.
    if (!saved.bench) saved = { ...saved, bench: [] };
    target = { kind: "template" };
    poolNote = "A template — classes and specs, however many of each the raid needs.";
  }

  /*
   * A shared plan wins over the saved board, so a link opens as it was sent.
   * `?plan=` is the only board format that travels in a URL — the whole board,
   * losslessly. Only the template shares: a roster's link is `?board=roster:<id>`,
   * which means nothing outside this database.
   */
  const shared = palette ? decodePlan(one(sp.plan)) : undefined;
  const board = shared ?? saved;

  /** Nothing to show: the rosters tab, before anyone has made one. */
  const noBoard = selection.tab === "rosters" && !report && !guildRoster;

  return (
    <div className="space-y-4">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Users className="h-5 w-5" /> Raid planner
          </span>
        }
        description={
          <>
            Eight groups of five, and what each one ends up with. TBC pays for grouping — shouts,
            totems, Bloodlust and a shadow priest&apos;s mana all stop at the party line — so where
            somebody stands is a decision, not bookkeeping. <strong>Rosters &amp; raids</strong> is
            your own people: named rosters to plan with, and every raid night you&apos;ve logged.
            <strong> Template</strong> designs the shape from classes and specs, nobody named.
            Either way: click to seat, drop onto a raider to slide in or swap, rename any group,
            and add or remove groups as the raid needs.
          </>
        }
      />

      <PoolPicker
        selection={selection}
        boards={boards.map((b) => ({ id: b.id, name: b.name }))}
        reports={reports.map((r) => ({
          code: r.report.code,
          label: `${format(parseISO(r.report.startTime), "d MMM")} · ${r.report.zone ?? r.report.title}`,
        }))}
      />

      {guildRoster && (
        <RosterTools board={guildRoster} rosterNames={roster.map((r) => r.name)} />
      )}

      {noBoard ? (
        <EmptyState
          title="No rosters yet"
          description="A roster is a named board built from your own raiders — your main team, a split's second group, next Wednesday. Make as many as you run."
          action={<NewRosterButton />}
        />
      ) : pool.length === 0 ? (
        <EmptyState
          title="Nobody to place"
          description={
            report
              ? "That raid night has no per-player rows yet. Re-fetch it once Warcraft Logs has finished parsing."
              : guildRoster
                ? "Nobody on the roster is a main or an alt — add characters on the Roster page, or add a trial above to plan with."
                : "No classes to plan with — which shouldn't happen. Reload the page."
          }
        />
      ) : (
        <RaidBoard
          // The board keeps its own copy in state — including the undo stack —
          // so it has to be remounted when the officer switches to another one.
          key={
            target.kind === "raid"
              ? `raid:${target.code}`
              : target.kind === "roster"
                ? `roster:${target.id}`
                : "template"
          }
          pool={pool}
          initial={board}
          note={poolNote}
          target={target}
          recovered={recovered}
          palette={palette}
          shared={shared !== undefined}
        />
      )}

      <ClassBuffReference />
    </div>
  );
}

/**
 * Two tabs, and under Guild the boards that belong to it.
 *
 * Switching deliberately does NOT carry the board across. Each raid night and
 * each roster owns its own board and shows the one saved against it;
 * carrying an arrangement over would overwrite one night's record with
 * another's the first time somebody hit save, which is exactly the history this
 * app exists to keep.
 */
function PoolPicker({
  selection,
  boards,
  reports,
}: {
  selection: { tab: string; rosterId?: string; reportCode?: string };
  boards: { id: string; name: string }[];
  reports: { code: string; label: string }[];
}) {
  const pill = "rounded-full border px-2.5 py-1 text-xs transition-colors duration-75 hover:bg-accent";
  const activePill = "border-foreground/30 bg-primary text-primary-foreground hover:bg-primary";
  const href = (pool: string) => `/raid-planner?board=${encodeURIComponent(pool)}`;
  const tab = "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors duration-75 hover:bg-accent";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {/*
         * Rosters & raids leads, because it is what the page is opened for:
         * sorting out Wednesday, not redesigning the abstract raid.
         *
         * And it is "Rosters & raids", not "Guild" — the top-level nav already
         * has a Guild (the dashboard), and two different things under one word
         * in one app is a question an officer has to stop and answer.
         */}
        <Link
          href={href("rosters")}
          className={cn(tab, selection.tab === "rosters" && activePill)}
          title="Your own rosters, and every raid night you've logged"
        >
          Rosters &amp; raids
        </Link>
        <Link
          href={href("template")}
          className={cn(tab, selection.tab === "template" && activePill)}
          title="Design the shape — classes and specs, nobody named"
        >
          Template
        </Link>
      </div>

      {selection.tab === "rosters" && (
        <div className="space-y-1.5 rounded-md border border-dashed p-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-16 shrink-0 text-xs font-medium text-muted-foreground">Rosters</span>
            {boards.map((b) => (
              <Link
                key={b.id}
                href={href(rosterBoardKey(b.id))}
                className={cn(pill, selection.rosterId === b.id && activePill)}
              >
                {b.name}
              </Link>
            ))}
            <NewRosterButton />
          </div>
          {reports.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-16 shrink-0 text-xs font-medium text-muted-foreground">Raids</span>
              {reports.map((r) => (
                <Link
                  key={r.code}
                  href={href(r.code)}
                  className={cn(pill, selection.reportCode === r.code && activePill)}
                >
                  {r.label}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** What each class is worth in a board — the reference behind the chips. */
function ClassBuffReference() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>What each class brings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {WOW_CLASSES.map((wowClass) => {
            const brings = buffsForClass(wowClass);
            return (
              <div key={wowClass} className="space-y-1">
                <h3 className="text-xs font-semibold" style={{ color: CLASS_TEXT_COLORS[wowClass as WowClass] }}>
                  {wowClass}
                </h3>
                <ul className="space-y-0.5 text-[11px] text-muted-foreground">
                  {brings.map((b) => {
                    const source = b.sources.find((s) => s.wowClass === wowClass);
                    return (
                      <li key={b.id} title={b.effect}>
                        <span className="text-foreground">{buffLabel(b)}</span>{" "}
                        <span className="opacity-70">
                          {SCOPE_LABELS[b.scope].toLowerCase()}
                          {source?.requires ? ` · ${source.requires}` : ""}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          &ldquo;Party&rdquo; means only that raider&apos;s own group gets it, so moving them
          changes coverage. &ldquo;Raid&rdquo; reaches everyone however they&apos;re grouped, and
          &ldquo;on the boss&rdquo; needs one provider for the whole raid. Where a buff needs a
          talent this app can&apos;t confirm, the chip says so rather than assuming it.
        </p>
      </CardContent>
    </Card>
  );
}
