"use server";

import { z } from "zod";
import { getWriteRepo } from "@/lib/data/repo";
import { refreshAfterWrite } from "@/lib/refresh";
import { itemDisplayName, isPlaceholderName } from "@/lib/items/item-data";
import { resolveItemsFromWowhead } from "@/lib/items/wowhead";

/**
 * Awarding loot by hand, from a character's own page — the path for everything
 * Gargul didn't capture: a drop nobody logged, an item traded after the raid,
 * a wishlist row an officer wants to settle.
 *
 * Manual awards are ordinary loot awards: the same ledger, the same wishlist
 * matching, the same fairness and contention numbers. There is no parallel
 * "manually marked" state to reconcile — clearing one deletes the award and the
 * wishlist row goes back to open.
 */

const awardSchema = z.object({
  characterId: z.string().min(1),
  itemId: z.number().int().positive("Enter a valid item id."),
  /** Optional: falls back to the item cache, then a Wowhead lookup. */
  itemName: z.string().optional(),
  offspec: z.boolean(),
  note: z.string().max(500).optional(),
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("session"), sessionId: z.string().min(1) }),
    z.object({
      kind: z.literal("new"),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date."),
      zone: z.string().min(1, "Pick a raid."),
    }),
  ]),
});

export type AwardItemInput = z.infer<typeof awardSchema>;
export type AwardActionResult = { ok: boolean; message: string };

export async function awardItemAction(input: AwardItemInput): Promise<AwardActionResult> {
  const parsed = awardSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "That award doesn't look valid." };
  }
  const { characterId, itemId, offspec, note, target } = parsed.data;

  try {
    const repo = await getWriteRepo();
    const character = (await repo.listCharacters()).find((c) => c.character.id === characterId);
    if (!character) return { ok: false, message: "That character no longer exists." };

    // Name it as well as we can before writing: the typed name, the cache, or
    // one Wowhead lookup — so the ledger never records another "Item #30048".
    let name = itemDisplayName(itemId, parsed.data.itemName, (await repo.getItem(itemId))?.name);
    if (isPlaceholderName(name)) {
      const { resolved } = await resolveItemsFromWowhead([itemId], { limit: 1 });
      if (resolved.length > 0) {
        await repo.saveResolvedItems(resolved);
        name = itemDisplayName(itemId, resolved[0].name);
      }
    }

    const winner = character.character.name;
    if (target.kind === "session") {
      const result = await repo.addLootAward(target.sessionId, {
        itemId,
        itemName: name,
        rawWinnerName: winner,
        characterId,
        external: false,
        offspec,
        note,
      });
      if (!result.ok) return { ok: false, message: result.error };
    } else {
      const result = await repo.createRaidSessionWithAwards(
        { date: target.date, zones: [target.zone], source: "manual", note: "Manual loot entry" },
        [
          {
            rawWinnerName: winner,
            itemId,
            itemName: name,
            awardedAt: `${target.date}T12:00:00`,
            offspec,
            note,
          },
        ],
      );
      if (result.inserted === 0) {
        return { ok: false, message: `${winner} is already recorded as winning that item on ${target.date}.` };
      }
    }

    refreshAfterWrite("/", "layout");
    return { ok: true, message: `Awarded “${name}” to ${winner}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Awarding the item failed." };
  }
}

const clearSchema = z.object({ awardId: z.string().min(1) });

/** Undo a manual (or imported) award — the wishlist row goes back to open. */
export async function clearAwardAction(input: { awardId: string }): Promise<AwardActionResult> {
  const parsed = clearSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Nothing to clear." };
  try {
    const repo = await getWriteRepo();
    const removed = await repo.deleteLootAward(parsed.data.awardId);
    if (!removed) return { ok: false, message: "That award was already gone." };
    refreshAfterWrite("/", "layout");
    return { ok: true, message: "Award removed — the wishlist slot is open again." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Removing the award failed." };
  }
}
