import type { Metadata } from "next";
import { getRepo } from "@/lib/data/repo";
import { PageHeader } from "@/components/page-header";
import { FeedbackList } from "@/components/feedback/feedback-list";

export const metadata: Metadata = { title: "Feedback" };

export default async function FeedbackPage() {
  const repo = await getRepo();
  const reports = await repo.listFeedback();
  const open = reports.filter((r) => r.status === "open").length;

  return (
    <div>
      <PageHeader
        title="Feedback"
        description={
          reports.length === 0
            ? "Bug reports filed from the widget in the corner of every page."
            : `${open} open · ${reports.length} total. Newest first, open ones on top.`
        }
      />
      <FeedbackList reports={reports} />
    </div>
  );
}
