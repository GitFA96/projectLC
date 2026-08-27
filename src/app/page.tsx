import type { Metadata } from "next";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { TriangleAlert } from "lucide-react";
import { getRepo } from "@/lib/data/repo";
import { KpiCard } from "@/components/kpi-card";
import { PageHeader } from "@/components/page-header";
import { ItemLink } from "@/components/item-link";
import { CharacterLink } from "@/components/class-badge";
import { FairnessPanel } from "@/components/fairness-panel";
import { LootWeightsEditor } from "@/components/loot/priority-editor";
import { ActivePhasePicker } from "@/components/guild/active-phase-picker";
import { VisibilityPicker } from "@/components/guild/visibility-picker";
import { GuildIdentityEditor } from "@/components/guild/identity-editor";
import {
  SuccessionBanner,
  SuccessionSettings,
} from "@/components/guild/succession-panel";
import { PolicyEditor } from "@/components/loot/policy-editor";
import { CollapsibleCard } from "@/components/logs/collapsible-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PHASES } from "@/lib/constants/wow";

import { pageView } from "@/lib/auth/view";
import { PublicProfile } from "@/components/guild/public-profile";
import { can } from "@/lib/auth/can";
export const metadata: Metadata = { title: "Guild" };

/**
 * The guild's own page: who they are, how the season is going, and the policy
 * every other page derives from.
 *
 * This is the page a multi-guild version splits first — see
 * docs/guild-and-player-profiles.md. Everything here is already scoped to one
 * guild; it just doesn't have to say which one yet.
 */
/**
 * One URL, two pages.
 *
 * A member gets the guild's own dashboard. Anybody else gets the public
 * profile — **a separately composed page, not this one with fields blanked**
 * (§6). Blanking is what leaks: the next field somebody adds to the dashboard
 * would be public until they remembered it shouldn't be, nothing would fail,
 * and the guild would find out from a rival.
 *
 * Declared `"public"` so an outsider is never bounced to sign in from a guild's
 * front door — signing in would not help them, and the page they came for is
 * right here. Every page below it still requires membership.
 */
export default async function GuildPage() {
  const access = await pageView("public");
  // An outsider is anybody with no membership in *this* guild — signed out, or
  // signed in and a guild master somewhere else entirely (§5). `unrestricted`
  // is the deployment that has not switched enforcement on, where there are no
  // memberships to have and everyone is effectively inside.
  if (!access.viewer.unrestricted && access.viewer.guild === null) {
    return (
      <PublicProfile profile={await (await getRepo()).getPublicProfile()} />
    );
  }

  const repo = await getRepo();
  const [data, weights, policy, encounters, succession] = await Promise.all([
    repo.getDashboard(),
    repo.getLootPriorityWeights(),
    repo.getGuildPolicy(),
    repo.listEncounterNames(),
    repo.getSuccessionState(),
  ]);
  const phaseMeta = PHASES.find((p) => p.phase === data.guild.activePhase);
  const canEditPolicy = can(access.viewer, "policy.edit");
  const canEditGuild = can(access.viewer, "guild.edit");

  return (
    <div className="space-y-5">
      {/* Above everything, and only when it has something to say. A takeover
          that arrives as a surprise is the failure worth designing against. */}
      <SuccessionBanner
        state={succession}
        canClaim={succession.eligible.some(
          (m) => m.membershipId === access.viewer.guild?.membershipId,
        )}
      />

      <PageHeader
        title={data.guild.name}
        description={`${data.guild.realm} · ${data.guild.faction} · ${phaseMeta?.name} (${phaseMeta?.zones.join(", ")})`}
      >
        <Link
          href="/roster"
          className="text-sm font-medium underline-offset-2 hover:underline"
        >
          {data.rosterSize} raiders →
        </Link>
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Raiders" value={data.rosterSize} sub="active roster" />
        <KpiCard
          label={`P${data.guild.activePhase} items awarded`}
          value={data.activePhaseAwards}
          sub="attributed by raid zone"
        />
        <KpiCard
          label={`Avg P${data.guild.activePhase} wishlist`}
          value={
            data.avgActivePhaseCompletion !== undefined
              ? `${data.avgActivePhaseCompletion}%`
              : "—"
          }
          sub="across imported wishlists"
        />
        <KpiCard
          label="Last raid"
          value={
            data.lastRaid ? format(parseISO(data.lastRaid.date), "d MMM") : "—"
          }
          sub={data.lastRaid?.zones.join(" + ")}
        />
      </div>

      {data.unresolvedCount > 0 && (
        <Link
          href="/loot?winner=unresolved"
          className="flex items-center gap-2.5 rounded-lg border border-warn-line bg-warn-soft px-3 py-2.5 text-sm text-warn-ink transition-colors hover:bg-warn-fill"
        >
          <TriangleAlert className="h-4 w-4 shrink-0" />
          <span>
            <span className="font-medium">
              {data.unresolvedCount} award
              {data.unresolvedCount === 1 ? "" : "s"} without a roster winner
            </span>{" "}
            — assign a character or mark them off-roster in the ledger.
          </span>
        </Link>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Recent raids</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {data.recentSessions.map(({ session, awardCount }) => (
              <Link
                key={session.id}
                href={`/loot?session=${encodeURIComponent(session.id)}`}
                className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {session.zones.join(" + ")}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {format(parseISO(session.date), "EEE d MMM yyyy")}
                    {session.note ? ` · ${session.note}` : ""}
                  </span>
                </span>
                <Badge variant="secondary" className="shrink-0 tabular-nums">
                  {awardCount} items
                </Badge>
              </Link>
            ))}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Most contested items</CardTitle>
            <p className="text-xs text-muted-foreground">
              Wishlisted by 2+ raiders, picked by open demand — ordered by the
              phase each drops in, the tier being raided first ·{" "}
              <Link
                href="/items"
                className="font-medium text-foreground hover:underline"
              >
                all items
              </Link>
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.contestedItems.map((c) => (
              <div
                key={c.itemId}
                className="flex items-center justify-between gap-2"
              >
                <ItemLink
                  item={{
                    itemId: c.itemId,
                    name: c.itemName,
                    quality: c.item?.quality,
                    icon: c.item?.icon,
                  }}
                  className="min-w-0"
                />
                <span className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
                  {/* Which tier it drops in decides whether an argument about
                      it is this month's or next year's — it orders the list,
                      and the tier being raided is filled in rather than
                      outlined. Absent when nobody has said — see the phase
                      control on the item's own page. */}
                  {c.item?.phase && (
                    <Badge
                      variant={
                        c.item.phase === data.guild.activePhase
                          ? "secondary"
                          : "outline"
                      }
                      className="px-1 py-0 text-[10px] font-medium"
                    >
                      P{c.item.phase}
                    </Badge>
                  )}
                  {c.wishers.length} want · {c.openCount} open
                </span>
              </div>
            ))}
            {data.contestedItems.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No contested wishlist items.
              </p>
            )}
          </CardContent>
        </Card>

        {/* The other half of the same question. The card above is what the
            council is about to argue over; this is how the last argument
            landed — who actually walked away with the thing they asked for. */}
        <Card>
          <CardHeader>
            <CardTitle>BiS won last raid week</CardTitle>
            <p className="text-xs text-muted-foreground">
              {data.bisWins.from && data.bisWins.to ? (
                <>
                  Awards that landed on the winner&apos;s own wishlist,{" "}
                  {format(parseISO(data.bisWins.from), "d MMM")}–
                  {format(parseISO(data.bisWins.to), "d MMM")} · tier tokens
                  counted as what they buy ·{" "}
                  <Link
                    href="/loot?match=matched&when=week"
                    className="font-medium text-foreground hover:underline"
                  >
                    open in the ledger
                  </Link>
                </>
              ) : (
                <>No loot imported yet — awards arrive from a Gargul export.</>
              )}
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.bisWins.wins.map((win) => (
              <div
                key={win.awardId}
                className="flex items-center justify-between gap-2"
                // Said on hover rather than in the row, the same way the
                // ledger says it — a token's own name is what dropped, and
                // spelling the redemption out inline would push the winner
                // off the end of a narrow card.
                title={
                  win.redeemsTo
                    ? `Buys ${win.redeemsTo.itemName}, which is on their wishlist`
                    : undefined
                }
              >
                <ItemLink
                  item={{
                    itemId: win.itemId,
                    name: win.itemName,
                    quality: win.item?.quality,
                    icon: win.item?.icon,
                  }}
                  className="min-w-0"
                />
                <span className="flex shrink-0 items-center gap-1.5 text-xs">
                  {/* Off-spec is marked, never hidden: an off-spec set is
                      still a list the raider wrote, and the council reads the
                      two differently. */}
                  {win.offspec && (
                    <Badge
                      variant="outline"
                      className="px-1 py-0 text-[10px] font-medium"
                      title="Awarded as off-spec"
                    >
                      OS
                    </Badge>
                  )}
                  {win.winnerClass ? (
                    <CharacterLink
                      name={win.winnerName}
                      wowClass={win.winnerClass}
                      className="text-xs"
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {win.winnerName}
                    </span>
                  )}
                </span>
              </div>
            ))}
            {data.bisWins.total > data.bisWins.wins.length && (
              <Link
                href="/loot?match=matched&when=week"
                className="block pt-0.5 text-xs text-muted-foreground hover:underline"
              >
                +{data.bisWins.total - data.bisWins.wins.length} more this week
                →
              </Link>
            )}
            {data.bisWins.wins.length === 0 && data.bisWins.from && (
              <p className="text-sm text-muted-foreground">
                Nobody won a wishlisted item last raid week.
              </p>
            )}
          </CardContent>
        </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Loot distribution</CardTitle>
            <p className="text-xs text-muted-foreground">
              On-spec awards per raider, by phase and roster (off-spec faded)
            </p>
          </CardHeader>
          <CardContent>
            <FairnessPanel
              defaultPhase={data.guild.activePhase}
              groups={data.fairness.map((g) => ({
                phase: g.phase,
                entries: g.entries.map((f) => ({
                  name: f.character.name,
                  wowClass: f.character.class,
                  onSpec: f.onSpec,
                  offSpec: f.offSpec,
                  status: f.character.status,
                })),
              }))}
            />
          </CardContent>
        </Card>
      </div>

      {/*
       * The settings below are gated on the capability each one's action
       * requires, not merely on membership.
       *
       * Showing a control that throws when clicked is worse than not showing
       * it: the raider reads it as the app being broken and tells an officer,
       * who cannot reproduce it. Hiding it is still only presentation — every
       * action re-checks — but it is the half that decides whether the page
       * makes sense to the person looking at it.
       */}
      {canEditPolicy && (
        <>
          <CollapsibleCard
            title="Loot policy — scoring weights"
            description="How much each metric counts when the priority sheet's spec order ties. Guild-wide: changing it re-ranks every contested item. Per-item spec priority is edited on the item itself."
            // Open by default: this is the page's setup half, not a footnote.
            defaultOpen
          >
            <LootWeightsEditor weights={weights} />
            <p className="mt-3 text-xs text-muted-foreground">
              Spec priority chains come from the council&apos;s{" "}
              <Link
                href="/loot/priority"
                className="font-medium text-foreground hover:underline"
              >
                priority sheet
              </Link>{" "}
              — one per phase, read and replaced there — and a single
              item&apos;s chain is edited on{" "}
              <Link
                href="/items"
                className="font-medium text-foreground hover:underline"
              >
                its own page
              </Link>
              . The sheet decides who is eligible; these weights only order the
              contenders inside a rung.
            </p>
          </CollapsibleCard>

          <CollapsibleCard
            title="Loot policy — the rest of the numbers"
            description="Everything else that encodes a judgement: how far behind an alt sits, what a slot already served costs, how far back “recent” looks, and what counts as prepared. Defaults are the app's, not the council's — until you change them."
          >
            <PolicyEditor policy={policy} encounters={encounters} />
          </CollapsibleCard>
        </>
      )}

      {canEditGuild && (
        <>
          <CollapsibleCard
            title="Guild identity"
            description="Name, realm and faction. A realm transfer is the case this exists for — the old values go into the audit log, because a rename changes what every past decision appears to have been made under."
          >
            <GuildIdentityEditor
              name={data.guild.name}
              realm={data.guild.realm}
              faction={data.guild.faction}
            />
          </CollapsibleCard>

          <CollapsibleCard
            title="Active phase"
            description="Which tier the guild is raiding. It decides whether a rare gem reads as acceptable or as behind the tier, which phase the priority sheet and the loot distribution open on, and what “current” means to gear grading — so switching it is how you see the same roster judged by another phase's rules."
          >
            <ActivePhasePicker activePhase={data.guild.activePhase} />
          </CollapsibleCard>

          <CollapsibleCard
            title="If the owners go quiet"
            description="Ownership is not a role, so a guild whose owners all disappear cannot appoint replacements — this is the way back. It never removes anybody: it lets somebody else become an owner too."
          >
            <SuccessionSettings state={succession} />
          </CollapsibleCard>

          <CollapsibleCard
            title="What the world sees"
            description="Anybody who isn't in this guild lands on a public page instead of this one. These presets decide how much of the guild it shows — never the council's own judgements, at any setting."
          >
            <VisibilityPicker current={data.guild.visibility} />
          </CollapsibleCard>
        </>
      )}
    </div>
  );
}
