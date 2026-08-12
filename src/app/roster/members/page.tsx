import type { Metadata } from "next";
import { getRepo } from "@/lib/data/repo";
import { authEnabled } from "@/lib/auth/viewer";
import { PageHeader } from "@/components/page-header";
import { MembersScreen } from "@/components/roster/members-screen";

import { pageView } from "@/lib/auth/view";
import { NoAccess } from "@/components/no-access";
export const metadata: Metadata = { title: "Members" };

/**
 * Rendered per request, unlike its neighbours.
 *
 * Two things on this page depend on the clock rather than on the data: whether
 * an invitation has lapsed, and how long ago somebody was last here. Prerendered
 * at build time, both freeze — and because an invitation expiring is not a
 * *write*, no `refreshAfterWrite()` ever thaws them, so a dead code would keep
 * showing a countdown until an officer happened to change something else.
 *
 * Nothing unsafe follows from that (redemption checks expiry against the real
 * clock, not against this page), but a screen about who can get in should not
 * be the one telling a comfortable lie.
 */
export const dynamic = "force-dynamic";

/**
 * The roster, seen as people instead of characters.
 *
 * Every other page here is keyed on a character, because that is what loot is
 * awarded to. This one is keyed on a membership, because that is what an
 * account, a permission and an invitation attach to. The gap between the two
 * lists — ninety characters, a handful of members — is the point of the screen
 * rather than a defect in it.
 */
export default async function MembersPage() {
  const access = await pageView("members.manage", { returnTo: "/roster/members" });
  if (!access.allowed) return <NoAccess reason={access.reason} />;

  const repo = await getRepo();
  const [guild, view] = await Promise.all([repo.getGuild(), repo.getMembersView()]);

  return (
    <>
      <PageHeader
        title="Members"
        description={
          <>
            The people behind the roster: who has an account in {guild.name}, which characters they
            play, and who has been invited but not arrived yet.
          </>
        }
      />
      <MembersScreen
        view={view}
        authEnabled={authEnabled()}
        // Ownership is not a capability, so the controls that change it are
        // shown on the fact rather than on a grant.
        viewerIsOwner={access.viewer.unrestricted || (access.viewer.guild?.isGuildMaster ?? false)}
        viewerMembershipId={access.viewer.guild?.membershipId ?? null}
      />
    </>
  );
}
