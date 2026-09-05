import { DatabaseSync } from "node:sqlite";
/**
 * A ranked fallback for a wishlist slot: "if not this, then that".
 *
 * Stored against the set rather than the item, because the alternative only
 * means anything in the context of the slot it stands in for.
 */

export interface StoredWishlistAlternative {
  characterId: string;
  phase: number;
  slot: string;
  itemId: number;
  itemName?: string;
  rank: number;
  note?: string;
}

export function getWishlistAlternatives(db: DatabaseSync): StoredWishlistAlternative[] {
  const rows = db
    .prepare(
      "SELECT character_id, phase, slot, item_id, item_name, rank, note FROM wishlist_alternatives ORDER BY rank, item_id",
    )
    .all() as {
    character_id: string;
    phase: number;
    slot: string;
    item_id: number;
    item_name: string | null;
    rank: number;
    note: string | null;
  }[];
  return rows.map((r) => ({
    characterId: r.character_id,
    phase: r.phase,
    slot: r.slot,
    itemId: r.item_id,
    itemName: r.item_name ?? undefined,
    rank: r.rank,
    note: r.note ?? undefined,
  }));
}

export function setWishlistAlternative(
  db: DatabaseSync,
  alt: StoredWishlistAlternative,
): void {
  db.prepare(
    `INSERT INTO wishlist_alternatives
       (character_id, phase, slot, item_id, item_name, rank, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(character_id, phase, slot, item_id) DO UPDATE SET
       item_name = excluded.item_name, rank = excluded.rank,
       note = excluded.note, updated_at = excluded.updated_at`,
  ).run(
    alt.characterId,
    alt.phase,
    alt.slot,
    alt.itemId,
    alt.itemName ?? null,
    alt.rank,
    alt.note ?? null,
    new Date().toISOString(),
  );
}

export function deleteWishlistAlternative(
  db: DatabaseSync,
  characterId: string,
  phase: number,
  slot: string,
  itemId: number,
): boolean {
  return (
    Number(
      db
        .prepare(
          "DELETE FROM wishlist_alternatives WHERE character_id = ? AND phase = ? AND slot = ? AND item_id = ?",
        )
        .run(characterId, phase, slot, itemId).changes,
    ) > 0
  );
}
