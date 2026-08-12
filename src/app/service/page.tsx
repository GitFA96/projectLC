import type { Metadata } from "next";
import Link from "next/link";
import { MessageSquareWarning, Package, Users } from "lucide-react";
import { getRepo } from "@/lib/data/repo";
import { countAccounts, getDb, loadStore } from "@/lib/data/db";
import { pageView } from "@/lib/auth/view";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Service" };

/**
 * Running the deployment, as opposed to running a guild.
 *
 * The split this page exists to make honest: **importing logs and sheets is
 * guild work**, done by whoever holds `import.run`, and it moved to
 * `/guild/import` where the rest of a guild's own business lives. What is left
 * here is the tenancy — accounts, guilds, and the reports people file about the
 * app itself.
 *
 * Nothing on this page reads a guild's judgements. An operator who wants those
 * needs a membership or an audited break-glass; the flag alone opens this
 * console and nothing else (§7).
 */
export default async function ServicePage() {
  const access = await pageView("app-admin", { returnTo: "/service" });
  if (!access.allowed) return <NoAccess reason={access.reason} />;

  const repo = await getRepo();
  const [feedback, unresolvedItems, unnamedEnchants] = await Promise.all([
    repo.listFeedback(),
    repo.listUnresolvedItemIds(),
    repo.listUnnamedEnchantIds(),
  ]);
  const db = getDb();
  const store = loadStore(db);
  const openReports = feedback.filter((r) => r.status === "open").length;
  const gaps = unresolvedItems.length + unnamedEnchants.length;

  return (
    <div>
      <PageHeader
        title="Service"
        description="Running this deployment. Guild business — the roster, the loot, the imports — belongs to the guilds themselves and is not reachable from here."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquareWarning className="h-4 w-4" />
              Feedback
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-2xl font-semibold tabular-nums">{openReports}</p>
            <p className="text-muted-foreground">
              {openReports === 0 ? "Nothing waiting." : "open, nobody has looked at them yet."}
            </p>
            <Link href="/service/feedback" className="underline underline-offset-2">
              Triage →
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Tenancy
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-muted-foreground">
            <p>
              <span className="font-medium text-foreground tabular-nums">{countAccounts(db)}</span>{" "}
              accounts
            </p>
            <p>
              <span className="font-medium text-foreground tabular-nums">
                {store.memberships.length}
              </span>{" "}
              memberships · <span className="tabular-nums">{store.guildRoles.length}</span> roles
            </p>
            <p>
              1 guild — <span className="text-foreground">{store.guild.name}</span>, publishing{" "}
              <span className="text-foreground">{store.guild.visibility}</span>
            </p>
            <Link href="/service/tenancy" className="inline-block underline underline-offset-2">
              Accounts and overrides →
            </Link>
          </CardContent>
        </Card>

        <Card className="sm:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              Item cache
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-2xl font-semibold tabular-nums">{gaps}</span>{" "}
              <span className="text-muted-foreground">
                {gaps === 0 ? "— Wowhead has named everything." : "ids Wowhead has not named yet."}
              </span>
            </p>
            {/*
              The reason this sits on the *service* page rather than a guild's.
              `items` has no `guild_id`: one cache serves the whole deployment,
              which is right — an item is an item — but it means a guild's
              imports have effects outside that guild. With one guild that is
              invisible. With two, the second inherits the first's resolutions
              (good) and also its wrong curations (not good), and this note is
              the warning that multi-guild has to answer that before it ships.
            */}
            <p className="text-muted-foreground">
              The cache is <strong>service-wide</strong> — one row per item id, shared by every
              guild — while the imports that fill it are run per guild. Resolving happens on{" "}
              <Link href="/guild/import" className="underline underline-offset-2">
                a guild&apos;s import page
              </Link>
              , because that is where somebody has the context to judge an id.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
