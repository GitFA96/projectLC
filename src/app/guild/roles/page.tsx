import type { Metadata } from "next";
import Link from "next/link";
import { getRepo } from "@/lib/data/repo";
import { PageHeader } from "@/components/page-header";
import { RolesEditor } from "@/components/guild/roles-editor";

import { pageView } from "@/lib/auth/view";
import { NoAccess } from "@/components/no-access";
export const metadata: Metadata = { title: "Roles" };

/**
 * What this guild's roles mean.
 *
 * A guild page rather than a roster one, and the split is worth keeping: here
 * you decide what "Officer" *is*, and on `/roster/members` you decide who is
 * one. They are different powers — `roles.manage` versus `members.manage` —
 * and the first is guild-master-equivalent while the second is ordinary
 * officer work.
 */
export default async function RolesPage() {
  const access = await pageView("roles.manage", { returnTo: "/guild/roles" });
  if (!access.allowed) return <NoAccess reason={access.reason} />;

  const view = await (await getRepo()).getMembersView();

  return (
    <>
      <PageHeader
        title="Roles"
        description={
          <>
            What each role in this guild is allowed to do. Who holds them is on the{" "}
            <Link href="/roster/members" className="underline underline-offset-2">
              members page
            </Link>
            .
          </>
        }
      />
      <RolesEditor roles={view.roles} ownerCount={view.ownerCount} />
    </>
  );
}
