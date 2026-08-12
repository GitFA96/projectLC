import type { NextRequest } from "next/server";
import { WclError, hasWclCredentials } from "@/lib/wcl/client";
import { fetchFightGraph, type FightGraphResult } from "@/lib/wcl/fight-graph";
import { can } from "@/lib/auth/can";
import { resolveViewer } from "@/lib/auth/viewer";

/**
 * GET /api/fight-graph?code=…&fight=…&player=…
 *
 * A route handler rather than a server action on purpose: the client
 * dispatches server actions one at a time, so loading four compared players
 * through an action took 4× a single fetch. Plain GETs run in parallel — and
 * since a logged fight never changes, the browser may cache the response too.
 *
 * **It carries its own `logs.view` check.** `pageView()` gates `page.tsx`; a
 * route handler is not a page and nothing gates it for us. The server action
 * this replaced held a `requireCapability` and the move to a route dropped it,
 * which left live Warcraft Logs data — fetched on the deployment's own API
 * credentials — answering anonymous requests. `routes.test.ts` now fails if a
 * handler outside the sign-in flow has no check.
 */
export async function GET(request: NextRequest) {
  if (!can(await resolveViewer(), "logs.view")) {
    const body: FightGraphResult = { status: "error", message: "You can't view this guild's logs." };
    return Response.json(body, { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const code = params.get("code") ?? "";
  const fightId = Number(params.get("fight"));
  const player = params.get("player") ?? "";
  if (!code || !player || !Number.isInteger(fightId) || fightId < 0) {
    const body: FightGraphResult = { status: "error", message: "Invalid fight-graph request." };
    return Response.json(body, { status: 400 });
  }
  if (!hasWclCredentials()) {
    return Response.json({ status: "not-configured" } satisfies FightGraphResult);
  }
  try {
    const data = await fetchFightGraph(code, fightId, player);
    return Response.json({ status: "ok", data } satisfies FightGraphResult, {
      headers: { "Cache-Control": "private, max-age=86400" },
    });
  } catch (e) {
    const message =
      e instanceof WclError ? e.message : `Fight graph failed: ${e instanceof Error ? e.message : String(e)}`;
    return Response.json({ status: "error", message } satisfies FightGraphResult);
  }
}
