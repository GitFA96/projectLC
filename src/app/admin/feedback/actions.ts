"use server";

import { z } from "zod";
import { getWriteRepo } from "@/lib/data/repo";
import { refreshAfterWrite } from "@/lib/refresh";
import { feedbackContextSchema } from "@/lib/import/schemas";

/**
 * Filing and triaging bug reports.
 *
 * `submitFeedback` is the one action in this app any visitor can reach — the
 * widget is on every page — so it validates hard and trusts nothing from the
 * client. In particular `context` is re-parsed here rather than stored raw:
 * the browser is the only source for it, and a field the reporter was shown
 * has to be the same field that lands in the database.
 */

const submitSchema = z.object({
  kind: z.enum(["bug", "feedback"]).default("bug"),
  body: z
    .string()
    .trim()
    .min(1, "Describe what went wrong first.")
    .max(4000, "Keep the description under 4000 characters."),
  reporter: z.string().trim().max(60).optional(),
  route: z.string().trim().min(1).max(300),
  url: z.string().trim().min(1).max(2000),
  /** Absent when the reporter left the context toggle off — that is the opt-out. */
  context: feedbackContextSchema.optional(),
});

export async function submitFeedback(input: {
  kind?: "bug" | "feedback";
  body: string;
  reporter?: string;
  route: string;
  url: string;
  context?: z.infer<typeof feedbackContextSchema>;
}): Promise<{ ok: boolean; message?: string }> {
  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid report." };
  }
  try {
    const repo = await getWriteRepo();
    const result = await repo.addFeedback({
      kind: parsed.data.kind,
      body: parsed.data.body,
      reporter: parsed.data.reporter || undefined,
      route: parsed.data.route,
      url: parsed.data.url,
      context: parsed.data.context,
    });
    if (!result.ok) return { ok: false, message: result.error };
    // Only the triage page reads these, but the read model is rebuilt off
    // data_version and the write already bumped it — so refresh to match.
    refreshAfterWrite("/admin/feedback", "page");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not send the report." };
  }
}

export async function setFeedbackStatus(input: {
  id: string;
  status: "open" | "resolved";
}): Promise<{ ok: boolean; message?: string }> {
  if (!input.id) return { ok: false, message: "Missing report id." };
  try {
    const repo = await getWriteRepo();
    const changed = await repo.setFeedbackStatus(input.id, input.status);
    if (!changed) return { ok: false, message: "Report not found — it may already be gone." };
    refreshAfterWrite("/admin/feedback", "page");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not update the report." };
  }
}

export async function deleteFeedback(input: { id: string }): Promise<{ ok: boolean; message?: string }> {
  if (!input.id) return { ok: false, message: "Missing report id." };
  try {
    const repo = await getWriteRepo();
    const removed = await repo.deleteFeedback(input.id);
    if (!removed) return { ok: false, message: "Report not found — it may already be gone." };
    refreshAfterWrite("/admin/feedback", "page");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not delete the report." };
  }
}
