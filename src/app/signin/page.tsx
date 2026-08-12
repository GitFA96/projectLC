import type { Metadata } from "next";
import Link from "next/link";
import { discordConfigured } from "@/lib/auth/discord";
import { INVITE_PROBLEM_TEXT, type InviteProblem } from "@/lib/auth/invites";
import { authEnabled } from "@/lib/auth/viewer";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";

import { pageView } from "@/lib/auth/view";
export const metadata: Metadata = { title: "Sign in" };

/**
 * Signing in.
 *
 * One door. Whether you also operate the service is a flag on your account, not
 * a second account and not a mode you pick here — and it grants nothing inside
 * any guild either way. See docs/guild-and-player-profiles.md §7.
 *
 * Errors arrive as a short code on the query string. None of them explain more
 * than the person needs: whoever is reading may not be who they say.
 */
const REASONS: Record<string, string> = {
  "not-configured": "Discord sign-in isn't set up on this deployment yet.",
  declined: "Sign-in was cancelled.",
  expired: "That sign-in took too long, or was started somewhere else. Try again.",
  discord: "Discord couldn't complete the sign-in. Try again in a moment.",
  disabled: "That account has been suspended.",
  "already-claimed": "This deployment has already been claimed.",
  unclaimed: "This deployment hasn't been set up yet — claim it first.",
  "bad-code": "That claim code isn't right.",
  "claim-failed": "The claim couldn't be completed.",
  unknown: "Something went wrong. Try again.",
  // Anything the invite flow refused, under its own prefix so the two sets of
  // reasons cannot collide. The text itself comes from the one place that
  // decides it, rather than being written out a second time here.
  ...Object.fromEntries(
    Object.entries(INVITE_PROBLEM_TEXT).map(([reason, text]) => [`invite-${reason as InviteProblem}`, text]),
  ),
};

export default async function SignInPage({
  searchParams,
}: {
  // Next 16: a Promise. See src/app/AGENTS.md.
  searchParams: Promise<{ error?: string; returnTo?: string }>;
}) {
  // Public on purpose — see the allowlist in pages.test.ts.
  await pageView("public");

  const { error, returnTo } = await searchParams;
  const ready = discordConfigured();
  const next = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : "";

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Sign in" description="projectLC uses your Discord account. No password to remember." />

      {error ? (
        <div className="mb-4 rounded-md border border-warn bg-warn-soft px-3 py-2 text-sm text-warn-ink">
          {REASONS[error] ?? REASONS.unknown}
        </div>
      ) : null}

      <Card>
        <CardContent className="space-y-4 py-6">
          {ready ? (
            <>
              <a
                href={`/api/auth/discord/start${next}`}
                className="block rounded-md bg-accent px-4 py-2 text-center text-sm font-medium text-accent-ink"
              >
                Continue with Discord
              </a>
              <p className="text-sm text-muted-foreground">
                We ask Discord for your username and avatar, and nothing else — not your email, and
                not which servers you are in.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Discord sign-in isn&apos;t configured. Set <code>DISCORD_CLIENT_ID</code>,{" "}
              <code>DISCORD_CLIENT_SECRET</code> and <code>DISCORD_REDIRECT_URI</code>, then restart.
            </p>
          )}

          {!authEnabled() ? (
            <p className="border-t pt-4 text-sm text-muted-foreground">
              Sign-in is not being enforced yet — <code>PROJECTLC_AUTH</code> is off, so every page
              is open and signing in changes nothing except who the app thinks you are.{" "}
              <Link href="/" className="underline">
                Back to the guild
              </Link>
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
