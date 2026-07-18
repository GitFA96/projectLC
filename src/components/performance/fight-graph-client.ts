import type { FightGraphResult } from "@/lib/wcl/fight-graph";

/**
 * Client-side loader for /api/fight-graph, shared by the performance-page
 * panel and the compare page. Fights are historical, so ok results cache at
 * module scope for the whole browser session — revisiting a pull costs no
 * request at all. Errors are NOT cached, so re-selecting a fight retries.
 */

const cache = new Map<string, FightGraphResult>();

export function fightGraphKey(code: string, fightId: number, player: string): string {
  return `${code}|${fightId}|${player}`;
}

export function peekFightGraph(key: string): FightGraphResult | undefined {
  return cache.get(key);
}

export async function loadFightGraph(key: string): Promise<FightGraphResult> {
  const hit = cache.get(key);
  if (hit) return hit;
  const [code, fightId, player] = key.split("|");
  let result: FightGraphResult;
  try {
    const res = await fetch(
      `/api/fight-graph?code=${encodeURIComponent(code)}&fight=${encodeURIComponent(fightId)}&player=${encodeURIComponent(player)}`,
    );
    result = (await res.json()) as FightGraphResult;
  } catch (e) {
    result = { status: "error", message: `Fight graph failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (result.status !== "error") cache.set(key, result);
  return result;
}
