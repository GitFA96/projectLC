import type { Metadata } from "next";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { ShieldAlert } from "lucide-react";
import { getRepo } from "@/lib/data/repo";
import { correctionsLog, filterByRaider } from "@/lib/analysis/corrections-log";
import { pageView } from "@/lib/auth/view";
import { CorrectionsLog } from "@/components/guild/corrections-log";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "Audit" };
export const dynamic = "force-dynamic";

/**
 * What has happened to this guild.
 *
 * **Behind `guild.view` — the baseline — on purpose.** Every other governance
 * screen is officer-level, and this one is not, because the entries it exists
 * hardest to surface are the ones an ordinary member most needs: an operator
 * opening a break-glass on their guild, and every capability they used with it.
 * Putting that behind `members.manage` would mean the people being administered
 * are the only ones who cannot see it, which is the opposite of accountability.
 *
 * Nothing on the **Governance** tab is a loot judgement. It is who joined, who
 * let them in, who changed what a role means, who owns the guild, and who
 * reached in from outside — governance, and the guild's own to read.
 *
 * **Corrections** is a second tab rather than more rows in that stream. An
 * officer changing what a raid says a raider drank is accountability of a
 * different kind, and merging the two would blur a line drawn on purpose: one
 * is about who holds power in this guild, the other about a judgement call on
 * one night's numbers. Both belong to the guild; neither explains the other.
 *
 * **Ledger** is the third, for the same reason again: an award edited or
 * removed after the fact. Those entries share the governance table — it is the
 * guild's append-only log and there is no second one worth having — so this
 * page splits them by kind rather than by source. Anything `loot.*` belongs to
 * the ledger tab and is filtered out of governance; a kind added on one side
 * and not the other would quietly vanish from both, which is why
 * `isLedger` is the only place that decides.
 */
const KIND_LABEL: Record<string, string> = {
  "deployment.claimed": "Claimed",
  "invite.issued": "Invited",
  "invite.joined": "Joined",
  "invite.linked": "Linked",
  "invite.revoked": "Withdrawn",
  "character.linked": "Character linked",
  "character.unlinked": "Character unlinked",
  "role.created": "Role created",
  "role.renamed": "Role renamed",
  "role.regranted": "Role changed",
  "role.deleted": "Role deleted",
  "member.roles": "Roles assigned",
  "member.removed": "Member removed",
  "owner.added": "Owner added",
  "owner.removed": "Owner removed",
  "guild.renamed": "Guild renamed",
  "break-glass.opened": "Operator override opened",
  "break-glass.used": "Operator override used",
  "break-glass.closed": "Operator override closed",
  "loot.amended": "Award edited",
  "loot.removed": "Award removed",
};

const isOverride = (kind: string) => kind.startsWith("break-glass");
/** Loot history, not governance — the split this page's two streams turn on. */
const isLedger = (kind: string) => kind.startsWith("loot.");

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; raider?: string }>;
}) {
  const access = await pageView("guild.view", { returnTo: "/guild/audit" });
  if (!access.allowed) return <NoAccess reason={access.reason} />;

  const { tab, raider } = await searchParams;
  const repo = await getRepo();
  const [entries, adjustmentsByCode, reports] = await Promise.all([
    repo.listGuildAudit(),
    repo.listConsumableAdjustments(),
    repo.listWclReports(),
  ]);
  const governance = entries.filter((e) => !isLedger(e.kind));
  const ledger = entries.filter((e) => isLedger(e.kind));
  const overrides = governance.filter((e) => isOverride(e.kind)).length;
  const corrections = correctionsLog(
    adjustmentsByCode,
    reports.map((r) => ({
      code: r.report.code,
      title: r.report.title,
      startedAt: r.report.startTime,
    })),
  );
  const onCorrections = tab === "corrections";
  const onLedger = tab === "ledger";
  const onGovernance = !onCorrections && !onLedger;
  const shown = onLedger ? ledger : governance;

  return (
    <>
      <PageHeader
        title="Audit"
        description="Everything that changed who is in this guild and what they may do, and every hand correction to what a raid says a raider used."
      />

      {/* Links, not client state: a filtered corrections view is something you
          send to the raider it is about. */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        <TabLink
          label="Governance"
          href="/guild/audit"
          active={onGovernance}
          count={governance.length}
        />
        <TabLink
          label="Corrections"
          href="/guild/audit?tab=corrections"
          active={onCorrections}
          count={corrections.length}
        />
        <TabLink
          label="Ledger"
          href="/guild/audit?tab=ledger"
          active={onLedger}
          count={ledger.length}
        />
      </div>

      {onCorrections ? (
        <CorrectionsLog
          entries={filterByRaider(corrections, raider)}
          all={corrections}
          raider={raider}
        />
      ) : (
        <>
          {onGovernance && overrides > 0 && (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-warn-line bg-warn-soft p-3 text-sm text-warn-ink">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                The person running this deployment has reached into this guild{" "}
                <strong>{overrides === 1 ? "once" : `${overrides} times`}</strong>. Each one is
                below, with the reason they gave.
              </span>
            </div>
          )}

          <Card>
            <CardContent className="py-4">
              {shown.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {onLedger
                    ? "No award has been edited or removed since this was recorded."
                    : "Nothing has happened yet."}
                </p>
              ) : (
                <ul className="space-y-4">
                  {shown.map((entry) => (
                    <li key={entry.id} className="border-b pb-4 last:border-0">
                      {/* Same shape as the corrections tab: what happened leads,
                          when it happened is pushed to the right edge, and the
                          sentence in between gets the width. The timestamp used
                          to open the line, which reserved a fixed gutter on
                          every row and left the text stopping halfway. */}
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 md:grid md:grid-cols-[11rem_minmax(0,1fr)_9.5rem]">
                        <Badge
                          variant={isOverride(entry.kind) ? "warning" : "muted"}
                          className="justify-self-start"
                        >
                          {KIND_LABEL[entry.kind] ?? entry.kind}
                        </Badge>
                        <span className="min-w-0 text-sm">
                          {entry.detail ?? `${entry.actor} — ${entry.kind}`}
                        </span>
                        <span className="text-xs tabular-nums text-muted-foreground md:text-right">
                          {format(parseISO(entry.at), "d MMM yyyy HH:mm")}
                        </span>
                      </div>
                      {/* A reason is required for a break-glass and absent for
                          almost everything else, so it stays a second line here
                          rather than becoming a mostly-empty column — the
                          opposite of what a column would be for. */}
                      {entry.reason && (
                        <p className="mt-1.5 border-l pl-3 text-xs text-muted-foreground md:ml-44">
                          Reason given: {entry.reason}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}

function TabLink({
  label,
  href,
  active,
  count,
}: {
  label: string;
  href: string;
  active: boolean;
  count: number;
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? "rounded-md border-b-2 border-primary px-3 py-1.5 text-sm font-medium"
          : "rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      }
    >
      {label}
      <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">{count}</span>
    </Link>
  );
}
