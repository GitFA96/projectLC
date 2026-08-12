import type { Metadata } from "next";
import { format, parseISO } from "date-fns";
import { ShieldAlert } from "lucide-react";
import { getRepo } from "@/lib/data/repo";
import { pageView } from "@/lib/auth/view";
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
 * Nothing here is a loot judgement. It is who joined, who let them in, who
 * changed what a role means, who owns the guild, and who reached in from
 * outside — governance, and the guild's own to read.
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
};

const isOverride = (kind: string) => kind.startsWith("break-glass");

export default async function AuditPage() {
  const access = await pageView("guild.view", { returnTo: "/guild/audit" });
  if (!access.allowed) return <NoAccess reason={access.reason} />;

  const entries = await (await getRepo()).listGuildAudit();
  const overrides = entries.filter((e) => isOverride(e.kind)).length;

  return (
    <>
      <PageHeader
        title="Audit"
        description="Everything that changed who is in this guild and what they may do. Not loot decisions — those are on the ledger."
      />

      {overrides > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-warn-line bg-warn-soft p-3 text-sm text-warn-ink">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            The person running this deployment has reached into this guild{" "}
            <strong>{overrides === 1 ? "once" : `${overrides} times`}</strong>. Each one is below,
            with the reason they gave.
          </span>
        </div>
      )}

      <Card>
        <CardContent className="py-4">
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing has happened yet.</p>
          ) : (
            <ul className="space-y-3">
              {entries.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b pb-3 last:border-0">
                  <span className="w-36 shrink-0 text-xs tabular-nums text-muted-foreground">
                    {format(parseISO(entry.at), "d MMM yyyy HH:mm")}
                  </span>
                  <Badge variant={isOverride(entry.kind) ? "warning" : "muted"}>
                    {KIND_LABEL[entry.kind] ?? entry.kind}
                  </Badge>
                  <span className="min-w-0 flex-1 text-sm">
                    {entry.detail ?? `${entry.actor} — ${entry.kind}`}
                    {entry.reason && (
                      <span className="block text-xs text-muted-foreground">
                        Reason given: {entry.reason}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
