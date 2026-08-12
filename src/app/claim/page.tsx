import type { Metadata } from "next";
import Link from "next/link";
import { deploymentClaimed } from "@/lib/auth/claim";
import { discordConfigured } from "@/lib/auth/discord";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";

import { pageView } from "@/lib/auth/view";
export const metadata: Metadata = { title: "Claim this deployment" };

/**
 * The one-time claim.
 *
 * A form rather than a link because the code has to travel with the request,
 * and a GET with the code in the URL would leave it in history and in any proxy
 * log. It posts to the start route, which stows it in the httpOnly state cookie
 * for the hop to Discord.
 *
 * The page closes itself the moment anybody holds an account — a claimed
 * deployment has nothing here to offer, and leaving the form up would invite
 * somebody to try codes against it.
 */
export default async function ClaimPage() {
  // Public on purpose — see the allowlist in pages.test.ts.
  await pageView("public");

  if (deploymentClaimed()) {
    return (
      <div className="mx-auto max-w-lg">
        <PageHeader title="Already claimed" description="This deployment has an owner." />
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Somebody has already claimed this deployment. If that should have been you, ask them for
            an invite — or check the server console if you own the machine.{" "}
            <Link href="/signin" className="underline">
              Sign in
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader
        title="Claim this deployment"
        description="Nobody owns this instance yet. Claiming makes you its guild master and its operator."
      />
      <Card>
        <CardContent className="space-y-4 py-6">
          {discordConfigured() ? (
            <form action="/api/auth/discord/start" method="GET" className="space-y-3">
              <label htmlFor="claim" className="block text-sm font-medium">
                Claim code
              </label>
              <p className="text-sm text-muted-foreground">
                Printed in the server console when the app started. It proves you own the machine,
                which is the only thing standing between this deployment and whoever finds the URL.
              </p>
              <input
                id="claim"
                name="claim"
                required
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
                placeholder="e.g. 4f2c9a10bd3e"
              />
              <button
                type="submit"
                className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink"
              >
                Claim with Discord
              </button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">
              Discord sign-in isn&apos;t configured yet, so there is no way to claim this deployment.
              Set <code>DISCORD_CLIENT_ID</code>, <code>DISCORD_CLIENT_SECRET</code> and{" "}
              <code>DISCORD_REDIRECT_URI</code>, then restart.
            </p>
          )}
          <p className="border-t pt-4 text-sm text-muted-foreground">
            You end up as this guild&apos;s <strong>guild master</strong> and the deployment&apos;s{" "}
            <strong>operator</strong> — one account, two powers. Operating the service grants
            nothing inside any guild, including guilds you are not a member of.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
