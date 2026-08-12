import type { Metadata } from "next";
import { findOpenBreakGlass, getDb, listAccounts, loadStore } from "@/lib/data/db";
import { currentAccount } from "@/lib/auth/session";
import { pageView } from "@/lib/auth/view";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TenancyTable } from "@/components/service/tenancy-table";
import { BreakGlassCard } from "@/components/service/break-glass-card";

export const metadata: Metadata = { title: "Tenancy" };
export const dynamic = "force-dynamic";

/**
 * Who has an account here, and the levers for when one goes wrong.
 *
 * The reason this page exists at all: `setAccountDisabled` and
 * `revokeAccountSessions` were written, tested and reachable from nothing. A
 * deployment with a compromised account had no way to stop it short of editing
 * the database — which is not a plan, it is the absence of one.
 *
 * Strictly service-level. It shows how many guilds an account belongs to and
 * never which, or what they hold there; an operator administers the tenancy,
 * and what somebody may do inside a guild is that guild's business (§7).
 */
export default async function TenancyPage() {
  const access = await pageView("app-admin", { returnTo: "/service/tenancy" });
  if (!access.allowed) return <NoAccess reason={access.reason} />;

  const db = getDb();
  const accounts = listAccounts(db);
  const me = await currentAccount();
  const store = loadStore(db);
  const open = me ? findOpenBreakGlass(db, me.id, store.guild.id) : undefined;
  const isMember = me ? store.memberships.some((m) => m.accountId === me.id) : false;

  return (
    <>
      <PageHeader
        title="Tenancy"
        description="Accounts on this deployment. Disabling one ends its access to the service — removing somebody from a guild is that guild's decision, on its own members page."
      />
      <Card className="mb-6">
        <CardContent className="py-4">
          <TenancyTable accounts={accounts} meId={me?.id ?? null} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reaching into a guild</CardTitle>
        </CardHeader>
        <CardContent>
          <BreakGlassCard
            guildId={store.guild.id}
            guildName={store.guild.name}
            open={open ? { reason: open.reason, expiresAt: open.expiresAt } : null}
            isMember={isMember}
          />
        </CardContent>
      </Card>
    </>
  );
}
