import type { Metadata } from "next";
import Link from "next/link";
import { FlaskConical, UserPlus, Users } from "lucide-react";
import { getRepo } from "@/lib/data/repo";
import { WOW_CLASSES, type WowClass } from "@/lib/constants/wow";
import { PageHeader } from "@/components/page-header";
import { RosterTable, type RosterRow } from "@/components/roster-table";
import {
  PuggersCard,
  PurgeDemoButton,
  UntrackedCard,
  type PuggerRow,
  type UntrackedRow,
} from "@/components/roster-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { pageView } from "@/lib/auth/view";
import { NoAccess } from "@/components/no-access";
export const metadata: Metadata = { title: "Roster" };

function asWowClass(name?: string): WowClass | undefined {
  return WOW_CLASSES.find((c) => c.toLowerCase() === name?.toLowerCase());
}

export default async function RosterPage() {
  const access = await pageView("roster.view", { returnTo: "/roster" });
  if (!access.allowed) return <NoAccess reason={access.reason} />;

  const repo = await getRepo();
  const [guild, summaries, untrackedPlayers] = await Promise.all([
    repo.getGuild(),
    repo.listCharacters(),
    repo.listUntrackedLogPlayers(),
  ]);

  const guildSummaries = summaries.filter((s) => s.character.status !== "pug");
  const hasDemoData = summaries.some((s) => s.character.id.startsWith("c-"));

  const rows: RosterRow[] = guildSummaries.map((s) => ({
    id: s.character.id,
    name: s.character.name,
    wowClass: s.character.class,
    spec: s.character.spec,
    offSpec: s.character.offSpec,
    offSpecRole: s.character.offSpecRole,
    role: s.character.role,
    status: s.character.status,
    completions: s.completionByPhase.map((c) => ({ phase: c.phase, pct: c.completion.pct })),
    totalAwards: s.totalAwards,
    activePhaseAwards: s.activePhaseAwards,
    offspecAwards: s.offspecAwards,
    lastAwardAt: s.lastAwardAt,
    hasCurrentGear: s.hasCurrentGear,
    attendance: s.attendance,
    loggedSpec: s.loggedSpec,
    mainCharacterName: s.mainCharacterName,
    professions: s.character.professions,
    professionGap: s.professionGap,
  }));

  const puggers: PuggerRow[] = summaries
    .filter((s) => s.character.status === "pug")
    .map((s) => ({
      id: s.character.id,
      name: s.character.name,
      wowClass: s.character.class,
      spec: s.character.spec,
      totalAwards: s.totalAwards,
      lastAwardAt: s.lastAwardAt,
    }));

  const untracked: UntrackedRow[] = untrackedPlayers.map((p) => ({
    ...p,
    knownClass: asWowClass(p.className),
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Roster"
        description="Wishlist progress and loot received per character — click a name for the full profile. Select rows for bulk moves between roster and puggers."
      >
        <Button asChild size="sm">
          <Link href="/roster/new">
            <UserPlus className="h-4 w-4" /> Add character
          </Link>
        </Button>
      </PageHeader>

      {hasDemoData && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn-line bg-warn-soft p-3">
          <p className="text-sm text-warn-ink">
            <span className="font-medium">Demo data is still mixed into this database.</span>{" "}
            <span className="text-warn-ink">
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
            but they stay out of roster KPIs and loot-fairness stats. Select rows to move them back
            to the roster — or delete them entirely.
          </p>
        </CardHeader>
        <CardContent>
          <PuggersCard rows={puggers} />
        </CardContent>
      </Card>

      {untracked.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-muted-foreground" /> Seen in logs, not tracked
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Names from imported Warcraft Logs reports that match nobody above. Select rows and
              track them — their existing log history attaches immediately (class &amp; spec
              prefilled from the log).
            </p>
          </CardHeader>
          <CardContent>
            <UntrackedCard players={untracked} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
