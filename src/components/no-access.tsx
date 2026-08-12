import Link from "next/link";
import { Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";

/**
 * What somebody sees when they are in the guild but not allowed on this page.
 *
 * A plain refusal rather than a 404. They know the guild exists — they are a
 * member of it — so pretending the page is missing would read as the site being
 * broken, and the officer gets a bug report instead of a request for access.
 *
 * It names the permission it wanted. Anything vaguer turns "ask an officer for
 * access" into a guessing game for both of them.
 */
export function NoAccess({ reason }: { reason: string }) {
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Not for you, yet" />
      <Card>
        <CardContent className="space-y-3 py-6">
          <p className="flex items-start gap-2 text-sm">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span>{reason}</span>
          </p>
          <p className="text-sm text-muted-foreground">
            An officer can grant it on the roles page. Nothing is wrong — this is the guild&apos;s
            own decision about who sees what.
          </p>
          <p className="border-t pt-3 text-sm">
            <Link href="/" className="underline underline-offset-2">
              Back to the guild
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
