"use server";

import { getWriteRepo } from "@/lib/data/repo";
import { refreshAfterWrite } from "@/lib/refresh";
import { requireAppAdmin } from "@/lib/auth/can";
import { resolveViewer } from "@/lib/auth/viewer";

/**
 * The foundational drop table — what each boss drops, for every guild.
 *
 * Gated on running the service rather than on a guild capability, because that
 * is what this data is: a fact about the game, the same on every realm. A guild
 * that disagrees says so in its own overlay and changes nothing for anybody
 * else.
 *
 * The seed reads a guild's priority sheets, which deserves saying out loud
 * given that `/service` otherwise never touches a guild's business. It takes
 * only the FACTUAL half — the boss heading, the item name, the slot wording —
 * and deliberately leaves the chain and the notes column behind. Those are the
 * council's judgement and none of an operator's concern.
 */
export interface DropActionResult {
  ok: boolean;
  message: string;
}

export async function seedFoundationalDropsAction(): Promise<DropActionResult> {
  try {
    requireAppAdmin(await resolveViewer());
    const repo = await getWriteRepo();
    const { fromSheets, fromCache, deduped } = await repo.seedFoundationalDrops();
    refreshAfterWrite("/", "layout");
    return {
      ok: true,
      message:
        fromSheets + fromCache === 0
          ? "Nothing to import — no priority sheet names a boss and no cached item carries one."
          : [
              `${fromSheets} from priority sheet headings, ${fromCache} from the item cache`,
              deduped > 0 ? `${deduped} duplicate row${deduped === 1 ? "" : "s"} cleared` : undefined,
              "Safe to press again; it only ever fills gaps.",
            ]
              .filter(Boolean)
              .join(" · "),
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not build the table." };
  }
}

export async function addFoundationalDropAction(input: {
  zone: string;
  boss: string;
  itemName: string;
  slotLabel?: string;
  note?: string;
  author?: string;
}): Promise<DropActionResult> {
  try {
    requireAppAdmin(await resolveViewer());
    if (!input.zone.trim() || !input.boss.trim() || !input.itemName.trim()) {
      return { ok: false, message: "A drop needs a zone, a boss and an item name." };
    }
    const repo = await getWriteRepo();
    // No item id: a drop table is written from a boss's loot list, in names.
    // The ordinary item resolver finds the id afterwards, through the same
    // exact-match rule everything else goes through.
    const written = await repo.upsertBossDrops([input]);
    refreshAfterWrite("/", "layout");
    return {
      ok: true,
      message:
        written > 0 ? `Added ${input.itemName} to ${input.boss}.` : "Already listed — nothing changed.",
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not add the drop." };
  }
}

export async function removeFoundationalDropAction(input: {
  zone: string;
  boss: string;
  itemName: string;
}): Promise<DropActionResult> {
  try {
    requireAppAdmin(await resolveViewer());
    const repo = await getWriteRepo();
    const removed = await repo.deleteBossDrop(input.zone, input.boss, input.itemName);
    if (!removed) return { ok: false, message: "That drop is already gone." };
    refreshAfterWrite("/", "layout");
    return { ok: true, message: `Removed ${input.itemName} from ${input.boss}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not remove the drop." };
  }
}
