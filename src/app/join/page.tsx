import type { Metadata } from "next";
import Link from "next/link";
import { getRepo } from "@/lib/data/repo";
import { discordConfigured } from "@/lib/auth/discord";
import { checkInvite, INVITE_PROBLEM_TEXT } from "@/lib/auth/invites";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";

import { pageView } from "@/lib/auth/view";
export const metadata: Metadata = { title: "Join" };

/**
 * The other side of an invitation.
 *
 * Checked here before anybody is sent to Discord, so a dead code costs a
 * sentence rather than a consent screen followed by a refusal. The check is a
 * courtesy, not a defence — `redeemInvite` re-checks inside its own transaction,
 * because anything decided on this page is already stale by the time the person
 * comes back from Discord.
 *
 * The code arrives in the URL when somebody follows a link, which is why the
 * page hands it onward as a **form POST-shaped GET to the start route**: from
 * there it lives in an httpOnly cookie and never reaches Discord's logs.
 */
export const dynamic = "force-dynamic";

export default async function JoinPage({
  searchParams,
}: {
  // Next 16: a Promise. See src/app/AGENTS.md.
  searchParams: Promise<{ code?: string }>;
}) {
  // Public on purpose — see the allowlist in pages.test.ts.
  await pageView("public");

  const { code } = await searchParams;
  const guild = await (await getRepo()).getGuild();

  if (!discordConfigured()) {
    return (
      <Shell title="Join">
        <p className="text-sm text-muted-foreground">
          Discord sign-in isn&apos;t configured on this deployment, so invitations can&apos;t be
          accepted yet.
        </p>
      </Shell>
    );
  }

  // No code yet: ask for one. Somebody who was sent a bare link lands here.
  if (!code) {
    return (
      <Shell title={`Join ${guild.name}`} description="An officer will have sent you a code.">
        <form action="/api/auth/discord/start" method="GET" className="space-y-3">
          <label htmlFor="invite" className="block text-sm font-medium">
            Invite code
          </label>
          <input
            id="invite"
            name="invite"
            required
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm tracking-wider"
            placeholder="XXXX-XXXX-XXXX-XXXX"
          />
          <button
            type="submit"
            className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink"
          >
            Continue with Discord
          </button>
        </form>
        <p className="border-t pt-4 text-sm text-muted-foreground">
          Signing in tells us your Discord name and nothing else — no email, no servers, no
          messages. It links you to the character the invitation names.
        </p>
      </Shell>
    );
  }

  const checked = checkInvite(code);
  if (!checked.ok) {
    return (
      <Shell title="This invitation can't be used">
        <p className="text-sm">{INVITE_PROBLEM_TEXT[checked.reason]}</p>
        <p className="text-sm text-muted-foreground">
          Ask an officer to send you a new one.{" "}
          <Link href="/join" className="underline">
            Try a different code
          </Link>
        </p>
      </Shell>
    );
  }

  return (
    <Shell
      title={`Join ${guild.name}`}
      description={`This invitation is for ${checked.preview.characterName}.`}
    >
      <form action="/api/auth/discord/start" method="GET" className="space-y-3">
        {/* The code goes to our own route, which moves it into an httpOnly
            cookie for the hop out. It is never a parameter Discord sees. */}
        <input type="hidden" name="invite" value={code} />
        <button
          type="submit"
          className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink"
        >
          Continue with Discord
        </button>
      </form>
      <p className="border-t pt-4 text-sm text-muted-foreground">
        You&apos;ll be linked to <strong>{checked.preview.characterName}</strong>, which is what
        makes your wishlist and your attendance yours. Signing in tells us your Discord name and
        nothing else.
      </p>
    </Shell>
  );
}

function Shell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title={title} description={description} />
      <Card>
        <CardContent className="space-y-4 py-6">{children}</CardContent>
      </Card>
    </div>
  );
}
