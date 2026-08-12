import { format, parseISO } from "date-fns";
import { CalendarDays, Users } from "lucide-react";
import { ClassBadge } from "@/components/class-badge";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PublicProfile as Profile } from "@/lib/analysis/public-profile";

/**
 * The guild's face, for somebody who is not in it.
 *
 * A separate component from the dashboard on purpose (§6): built as the member
 * page with fields blanked, the next field somebody adds is public until they
 * remember it shouldn't, and the guild finds out from a rival. This one can
 * only render what `PublicProfile` carries, and `PublicProfile` carries only
 * what `public-profile.ts` names.
 *
 * **No character links.** Names are shown, because a named roster is already on
 * the guild's Warcraft Logs page and pretending otherwise protects nothing.
 * Linking them is different: a character page is the council's view of a
 * raider, and a stranger following that link would land on a refusal at best.
 */
export function PublicProfile({ profile }: { profile: Profile }) {
  const nothingPublished = profile.roster === null && profile.raidNights === null;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={profile.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{profile.realm}</span>
            <Badge variant="outline">{profile.faction}</Badge>
            {profile.activePhase !== null && <Badge variant="muted">Phase {profile.activePhase} </Badge>}
          </span>
        }
      />

      {nothingPublished && (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            This guild keeps its roster and its raids to itself. If you were sent here to join, use
            the invite link an officer gave you.
          </CardContent>
        </Card>
      )}

      {profile.roster !== null && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Roster
              <Badge variant="muted">{profile.rosterSize}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {profile.roster.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nobody on the roster yet.</p>
            ) : (
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {profile.roster.map((c) => (
                  <li key={c.name} className="flex items-center gap-2 text-sm">
                    <ClassBadge wowClass={c.wowClass} spec={c.spec} />
                    <span className="font-medium">{c.name}</span>
                    <span className="text-xs text-muted-foreground">{c.role}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {profile.raidNights !== null && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4" />
              Recent raids
            </CardTitle>
          </CardHeader>
          <CardContent>
            {profile.raidNights.length === 0 ? (
              <p className="text-sm text-muted-foreground">No raids logged yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {profile.raidNights.map((night) => (
                  <li key={night.date} className="flex flex-wrap items-baseline gap-2 text-sm">
                    <span className="w-24 shrink-0 tabular-nums text-muted-foreground">
                      {format(parseISO(night.date), "d MMM yyyy")}
                    </span>
                    <span>{night.zones.join(", ")}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
