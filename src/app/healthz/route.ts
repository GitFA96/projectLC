import { NextResponse } from "next/server";
import { deploymentClaimed } from "@/lib/auth/claim";
import { pageView } from "@/lib/auth/view";

/**
 * Liveness probe. Deliberately public, and deliberately says almost nothing.
 *
 * `pageView("public")` is not decoration: `routes.test.ts` fails any handler
 * that decides nothing about who is asking, and being *public* is a decision.
 * Declaring it in the app's own vocabulary is how this route stays visible to
 * that test rather than becoming a second exception beside the sign-in flow.
 *
 * **It touches the database on purpose.** A probe that returns a constant only
 * proves Node is running, which is the failure mode nobody has. Reading whether
 * the deployment is claimed is the cheapest question that proves the file
 * opened, the schema is there and a query answers — the same reason the
 * deployment spec used to nominate `GET /signin` as the poor man's probe.
 *
 * The body carries no version, no guild and no counts. A health endpoint is
 * reachable by anyone who can reach the host, so it is not a place to describe
 * the deployment.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  await pageView("public");

  try {
    // The value is irrelevant — that it answers at all is the check.
    deploymentClaimed();
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
