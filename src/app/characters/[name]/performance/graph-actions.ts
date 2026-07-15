"use server";

import { z } from "zod";
import { WclError, hasWclCredentials } from "@/lib/wcl/client";
import { fetchFightGraph, type FightGraphView } from "@/lib/wcl/fight-graph";

const inputSchema = z.object({
  code: z.string().min(1),
  fightId: z.number().int().nonnegative(),
  actorName: z.string().min(1),
});

export type FightGraphActionResult =
  | { status: "ok"; data: FightGraphView }
  | { status: "not-configured" }
  | { status: "error"; message: string };

/** Live-fetch one player's DPS graph + cast/buff overlays for one pull. */
export async function fetchFightGraphAction(input: {
  code: string;
  fightId: number;
  actorName: string;
}): Promise<FightGraphActionResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: "Invalid fight-graph request." };
  if (!hasWclCredentials()) return { status: "not-configured" };
  try {
    const data = await fetchFightGraph(parsed.data.code, parsed.data.fightId, parsed.data.actorName);
    return { status: "ok", data };
  } catch (e) {
    if (e instanceof WclError) return { status: "error", message: e.message };
    return { status: "error", message: `Fight graph failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}
