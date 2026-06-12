import type { Metadata } from "next";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { FlaskConical, UserPlus, Users } from "lucide-react";
import { getRepo } from "@/lib/data/repo";
import { WOW_CLASSES, type WowClass } from "@/lib/constants/wow";
import { PageHeader } from "@/components/page-header";
import { RosterTable, type RosterRow } from "@/components/roster-table";
import { CharacterLink, ClassBadge } from "@/components/class-badge";
import { PurgeDemoButton, StatusMoveButton, TrackPlayerButtons } from "@/components/roster-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata: Metadata = { title: "Roster" };

function asWowClass(name?: string): WowClass | undefined {
  return WOW_CLASSES.find((c) => c.toLowerCase() === name?.toLowerCase());
}

export default async function RosterPage() {
  const repo = await getRepo();
  const [guild, summaries, untracked] = await Promise.all([
    repo.getGuild(),
    repo.listCharacters(),
    repo.listUntrackedLogPlayers(),
  ]);

  const guildSummaries = summaries.filter((s) => s.character.status !== "pug");
  const puggers = summaries.filter((s) => s.character.status === "pug");
  const hasDemoData = summaries.some((s) => s.character.id.startsWith("c-"));

  const rows: RosterRow[] = guildSummaries.map((s) => ({
    name: s.character.name,
    wowClass: s.character.class,
    spec: s.character.spec,
    role: s.character.role,
    status: s.character.status,
    completions: s.completionByPhase.map((c) => ({ phase: c.phase, pct: c.completion.pct })),
    totalAwards: s.totalAwards,
    activePhaseAwards: s.activePhaseAwards,
    offspecAwards: s.offspecAwards,
    lastAwardAt: s.lastAwardAt,
    hasCurrentGear: s.hasCurrentGear,
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Roster"
        description="Wishlist progress and loot received per character — click a name for the full profile."
      >
        <Button asChild size="sm">
          <Link href="/roster/new">
            <UserPlus className="h-4 w-4" /> Add character
          </Link>
        </Button>
      </PageHeader>

      {hasDemoData && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm text-amber-800">
            <span className="font-medium">Demo data is still mixed into this database.</span>{" "}
            <span className="text-amber-700">
              Removing it deletes the fictional characters with their sessions, awards and gear
              sets — everything you imported yourself stays (the item cache too).
            </span>
          </p>
          <PurgeDemoButton />
        </div>
      )}

      <RosterTable rows={rows} activePhase={guild.activePhase} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" /> Known puggers &amp; off-roster alts
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Tracked players outside the guild roster: their loot and log history link to a profile,
            but they stay out of roster KPIs and loot-fairness stats. Move someone here from their
            edit page (status “pug”), or promote them back below.
          </p>
        </CardHeader>
        <CardContent>
          {puggers.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">
              No known puggers yet — names seen in logs show up below, Gargul winners are resolved
              in the loot ledger.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Player</TableHead>
                  <TableHead>Class &amp; spec</TableHead>
                  <TableHead className="text-right">Items won</TableHead>
                  <TableHead className="w-32">Last award</TableHead>
                  <TableHead className="w-36"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {puggers.map((s) => (
                  <TableRow key={s.character.id}>
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        <CharacterLink name={s.character.name} wowClass={s.character.class} />
                        <Badge variant="muted">pug</Badge>
                      </span>
                    </TableCell>
                    <TableCell>
                      <ClassBadge wowClass={s.character.class} spec={s.character.spec} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s.totalAwards}</TableCell>
                    <TableCell className="text-sm tabular-nums text-muted-foreground">
                      {s.lastAwardAt ? format(parseISO(s.lastAwardAt), "d MMM yyyy") : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <StatusMoveButton characterId={s.character.id} to="main">
                        Move to roster
                      </StatusMoveButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {untracked.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-muted-foreground" /> Seen in logs, not tracked
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Names from imported Warcraft Logs reports that match nobody above. Tracking one
              attaches their existing log history immediately (class &amp; spec are prefilled from
              the log) — as a known pugger, or straight onto the roster if they joined.
            </p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Class &amp; spec (from log)</TableHead>
                  <TableHead className="text-right">Boss pulls</TableHead>
                  <TableHead className="w-32">Last seen</TableHead>
                  <TableHead className="w-56"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {untracked.map((p) => {
                  const wowClass = asWowClass(p.className);
                  return (
                    <TableRow key={p.name.toLowerCase()}>
                      <TableCell className="text-sm font-medium">{p.name}</TableCell>
                      <TableCell>
                        {wowClass ? (
                          <ClassBadge wowClass={wowClass} spec={p.spec ?? "?"} />
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            {[p.className, p.spec].filter(Boolean).join(" · ") || "unknown"}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p.appearances}
                        <span className="text-xs text-muted-foreground">
                          {" "}
                          in {p.reportCount} report{p.reportCount === 1 ? "" : "s"}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm tabular-nums text-muted-foreground">
                        {p.lastSeen ? format(parseISO(p.lastSeen), "d MMM yyyy") : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <TrackPlayerButtons player={p} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
