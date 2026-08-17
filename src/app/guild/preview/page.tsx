import type { Metadata } from "next";
import { getRepo } from "@/lib/data/repo";
import { pageView } from "@/lib/auth/view";
import { permits, ROUTE_NEEDS } from "@/lib/auth/view";
import { memberViewer } from "@/lib/auth/viewer";
import { CAPABILITIES, type Capability } from "@/lib/auth/capabilities";
import { VISIBILITY_LADDER, VISIBILITY_META } from "@/lib/analysis/public-profile";
import {
  MemberAccessPanel,
  type MemberAccess,
  type RouteNeed,
} from "@/components/guild/member-access";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Permissions preview" };
export const dynamic = "force-dynamic";

/**
 * What everybody can actually see and do — answered without asking them.
 *
 * ## Why this is a guild page and not a service one
 *
 * The obvious home is the operator console, and it is the wrong one. Everything
 * here *is* guild data: who is in it, what they hold, what the guild publishes.
 * An app admin reading that off a service page would be the §7 back door
 * arriving through the diagnostics door, and it would be no less of a back door
 * for being read-only. So it sits behind `roles.manage`, with the guild's own
 * roles, and an operator who is not a member cannot reach it either.
 *
 * ## Why it is safe to leave switched on in production
 *
 * **It previews; it never impersonates.** Every row is computed by asking
 * `permits()` what a viewer *would* be allowed, using a `Viewer` built here from
 * stored grants — nothing changes who is making the request, and there is no
 * path from this page to a write. That is a property of the construction rather
 * than a flag somebody has to remember to leave off, which is what makes it
 * safe in prod rather than dev-only.
 *
 * The alternative — "view as this member", where your session actually becomes
 * theirs — is account takeover with a friendly name, and no amount of gating
 * makes it something to run against real guild data.
 */
export default async function PermissionsPreviewPage() {
  const access = await pageView("roles.manage", { returnTo: "/guild/preview" });
  if (!access.allowed) return <NoAccess reason={access.reason} />;

  const repo = await getRepo();
  const now = new Date();
  const at = (days: number) => new Date(now.getTime() + days * 86400000).toISOString();

  const [view, publicFaces, forecast] = await Promise.all([
    repo.getMembersView(),
    Promise.all(VISIBILITY_LADDER.map((v) => repo.getPublicProfile(v))),
    Promise.all([0, 30, 60, 90].map(async (d) => ({ days: d, state: await repo.getSuccessionState(at(d)) }))),
  ]);

  /*
   * A viewer per member, built from their stored grants, then asked every
   * question up front.
   *
   * This is the whole trick: `permits()` is the same function the pages and the
   * nav call, so what this page shows is what will actually happen — not a
   * second implementation of the rule that can drift away from the first. It
   * stays true with the picker in front of it **because the answers are
   * computed here**: the client is handed booleans and chooses which to show,
   * never a capability list to reason about itself.
   */
  const routeNeeds = Object.entries(ROUTE_NEEDS);
  const routes: RouteNeed[] = routeNeeds.map(([href, need]) => ({ href, need }));
  const capabilityIds = Object.keys(CAPABILITIES) as Capability[];

  const members: MemberAccess[] = view.members.map((m) => {
    const viewer = memberViewer({
      accountId: `preview_${m.membershipId}`,
      guildId: "preview",
      membershipId: m.membershipId,
      isGuildMaster: m.isGuildMaster,
      capabilities: m.capabilities,
    });
    return {
      membershipId: m.membershipId,
      displayName: m.displayName,
      isGuildMaster: m.isGuildMaster,
      roleNames: m.roles.map((r) => r.name),
      capabilities: Object.fromEntries(capabilityIds.map((id) => [id, permits(viewer, id)])),
      pages: Object.fromEntries(routeNeeds.map(([href, need]) => [href, permits(viewer, need)])),
    };
  });

  return (
    <>
      <PageHeader
        title="Permissions preview"
        description="What each member can see and do, worked out from the roles this guild has granted. Nothing here changes anything — it answers questions rather than acting on them."
      />

      <div className="space-y-6">
        <MemberAccessPanel members={members} routes={routes} />

        <Card>
          <CardHeader>
            <CardTitle>If nobody signs in from today</CardTitle>
          </CardHeader>
          <CardContent>
            {/*
              `successionState` takes the clock as an argument precisely so this
              is answerable without waiting. Asking "what does this say in sixty
              days" is the only way to check the ladder before it matters.
            */}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>In</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Who could take ownership</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {forecast.map(({ days, state }) => (
                  <TableRow key={days}>
                    <TableCell className="tabular-nums">{days === 0 ? "now" : `${days} days`}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          state.status === "healthy"
                            ? "success"
                            : state.status === "warning"
                              ? "warning"
                              : "destructive"
                        }
                      >
                        {state.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {state.eligible.length > 0
                        ? state.eligible.map((m) => m.displayName).join(", ")
                        : "nobody"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="mt-2 text-xs text-muted-foreground">
              Assumes nobody signs in at all from now on. Any owner signing in resets it to healthy.
              A tier with nobody in it simply passes — that is why the second window exists.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>What a stranger would see</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            {publicFaces.map((face, i) => {
              const preset = VISIBILITY_LADDER[i];
              return (
                <div key={preset} className="space-y-1 rounded-md border p-3">
                  <p className="text-sm font-medium">
                    {VISIBILITY_META[preset].label}
                    {preset === face.visibility && <Badge className="ml-2">current</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">Name, realm, faction</p>
                  <p className="text-xs text-muted-foreground">
                    Tier: {face.activePhase === null ? "hidden" : `phase ${face.activePhase}`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Roster: {face.rosterSize === null ? "hidden" : `${face.rosterSize} by name`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Raids: {face.raidNights === null ? "hidden" : `${face.raidNights.length} recent`}
                  </p>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
