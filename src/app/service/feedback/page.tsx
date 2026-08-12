import type { Metadata } from "next";
import { getRepo } from "@/lib/data/repo";
import { PageHeader } from "@/components/page-header";
import { FeedbackList } from "@/components/feedback/feedback-list";

import { pageView } from "@/lib/auth/view";
import { NoAccess } from "@/components/no-access";
export const metadata: Metadata = { title: "Feedback" };

export default async function FeedbackPage() {
  const access = await pageView("app-admin", { returnTo: "/service" });
  if (!access.allowed) return <NoAccess reason={access.reason} />;

  const repo = await getRepo();
  const reports = await repo.listFeedback();
  const open = reports.filter((r) => r.status === "open").length;
  const major = reports.filter((r) => r.status === "open" && r.priority === "major").length;

  return (
    <div>
      <PageHeader
        title="Feedback"
        description={
          reports.length === 0
            ? "Bug reports filed from the widget in the corner of every page."
            : `${open} open${major > 0 ? ` (${major} major)` : ""} · ${reports.length} total. Open ones on top, worst first.`
        }
      />
      <FeedbackList reports={reports} />
    </div>
  );
}
