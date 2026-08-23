/**
 * The drop table a guild actually reads: the foundational one, with that
 * guild's own additions and removals laid over it.
 *
 * Two layers, and the split is the point. What a boss drops is a fact about the
 * game — identical for every guild, and correctable once by whoever runs the
 * service. What a guild does about it is a judgement, and theirs. Welding the
 * two together is what made a one-letter item-name typo a code change and a
 * deploy.
 *
 * The foundational layer is never mutated here. An overlay row says "we also
 * count this" or "we don't count this", and both are additive statements about
 * a base that stays exactly as the operator wrote it — so an operator fixing a
 * name cannot silently revert a guild's ruling, and a guild can never edit what
 * another guild reads.
 *
 * Pure.
 */

import type { BossDrop, GuildBossDrop, Quality } from "@/lib/types";

/**
 * One drop as an operator writes it.
 *
 * Names, not keys: a drop table is written from a boss's loot list, and the
 * normalization that turns "The Illidari Council" into a key is the writer's
 * job, not the caller's. `itemId` is optional and usually absent — the ordinary
 * item resolver fills it in afterwards.
 */
export interface BossDropDraft {
  zone: string;
  boss: string;
  itemName: string;
  itemId?: number;
  slotLabel?: string;
  note?: string;
  author?: string;
}

/** Where a drop in the merged table came from, so a reader can tell. */
export type DropOrigin = "foundation" | "guild";

export interface MergedDrop {
  zone: string;
  bossKey: string;
  boss: string;
  itemKey: string;
  /**
   * What to call it. **Wowhead's name when the drop resolves to an item**, the
   * name as typed otherwise.
   *
   * The stored `item_name` is how a drop was written down — it has to be kept,
   * because it is half the key and because a drop exists before any id does.
   * It is not, however, an authority on what the item is called: Wowhead is,
   * and eleven of this guild's 488 rows were carrying a sheet's capitalisation
   * or a genuine typo. Reading the name off the resolved item means a
   * correction lands everywhere at once instead of being retyped per table.
   */
  itemName: string;
  /** As written in the drop table, when that differs from the resolved name. */
  writtenName?: string;
  /**
   * What the item is really called, when the written name was kept anyway
   * because a sibling under the same boss resolves to the same thing. Both
   * Warglaives of Azzinoth are the case this exists for.
   */
  resolvedName?: string;
  /**
   * Enough of the cached item to render it the way every other list does — the
   * icon and the quality colour. Read off the item cache beside the name, for
   * the same reason: a drop table that stored its own copy would show a stale
   * icon after a Wowhead correction, and nobody would notice.
   */
  quality?: Quality;
  icon?: string;
  itemId?: number;
  slotLabel?: string;
  note?: string;
  /**
   * `guild` means this guild added it and nobody else sees it. Worth carrying
   * to the UI: an operator correcting the foundation needs to know which rows
   * are not theirs to correct.
   */
  origin: DropOrigin;
}

/**
 * Merge one zone's foundational drops with a guild's overlay.
 *
 * Order matters and is deliberate: hides are applied to the foundation, then
 * adds are appended. A guild that both hides and adds the same item under one
 * boss ends up with it present — they said "add" last in the only sense that
 * matters, which is that an explicit add is a positive statement and a hide is
 * the absence of one. That combination is how a drop is moved between bosses,
 * so it has to resolve predictably rather than cancel out.
 */
export function mergeDropTable(
  foundation: BossDrop[],
  overlay: GuildBossDrop[],
): MergedDrop[] {
  const hidden = new Set(
    overlay.filter((o) => o.action === "hide").map((o) => dropKey(o.bossKey, o.itemKey)),
  );

  const merged: MergedDrop[] = foundation
    .filter((d) => !hidden.has(dropKey(d.bossKey, d.itemKey)))
    .map((d) => ({ ...d, origin: "foundation" as const }));

  const present = new Set(merged.map((d) => dropKey(d.bossKey, d.itemKey)));
  for (const add of overlay) {
    if (add.action !== "add") continue;
    const key = dropKey(add.bossKey, add.itemKey);
    // The foundation already lists it under this boss — the guild's row is
    // redundant rather than wrong, and duplicating it would show the drop twice.
    if (present.has(key)) continue;
    present.add(key);
    merged.push({
      zone: add.zone,
      bossKey: add.bossKey,
      boss: add.boss,
      itemKey: add.itemKey,
      itemName: add.itemName,
      itemId: add.itemId,
      slotLabel: add.slotLabel,
      note: add.note,
      origin: "guild",
    });
  }
  return merged;
}

/**
 * A drop is identified by its boss and its item, never by either spelling.
 *
 * Both halves are already normalized — `bossKey` by whoever wrote the row,
 * `itemKey` by the sheet's own rule — and this deliberately does NOT normalize
 * again. Re-running `bossKey` here would be a second, quieter place that
 * decides what a boss is called, and the two would eventually disagree. The
 * writer owns it; see `bossDropSchema`.
 *
 * **Exported because the loot plan needs the same key.** It has to apply a
 * guild's hides to drops that reach it from the item cache rather than from
 * this table, and its first version keyed those on the item alone — so hiding
 * a drop under one boss also hid the copy the guild had just re-added under
 * another, which is precisely how a move between bosses is expressed.
 */
export function dropKey(bossKey: string, itemKey: string): string {
  return `${bossKey}|${itemKey}`;
}

/**
 * Point every resolved drop at the item cache for its name.
 *
 * Applied after merging so it covers a guild's own additions too — those are
 * typed by an officer in a hurry and are the likeliest of all to be misspelled.
 * A drop with no resolved item keeps what it was given: that name is the only
 * handle anybody has on it.
 */
/** What the item cache knows about a drop, for rendering it. */
export interface ResolvedItemFacts {
  name?: string;
  quality?: Quality;
  icon?: string;
}

export function resolveDropNames(
  drops: MergedDrop[],
  factsOf: (itemId: number) => ResolvedItemFacts | undefined,
): MergedDrop[] {
  // Two of a boss's drops can share an item name — both Warglaives of Azzinoth
  // really are called "Warglaive of Azzinoth". Where that happens the written
  // name is carrying the only thing that tells them apart ("(Main Hand)"), and
  // it is the council's annotation rather than anyone's item name. Replacing it
  // with Wowhead's leaves two identical rows under Illidan and no way to say
  // which one the chain is about.
  const resolvedCount = new Map<string, number>();
  for (const drop of drops) {
    if (drop.itemId === undefined) continue;
    const real = factsOf(drop.itemId)?.name;
    if (!real) continue;
    const key = `${drop.bossKey}|${real.toLowerCase()}`;
    resolvedCount.set(key, (resolvedCount.get(key) ?? 0) + 1);
  }

  return drops.map((drop) => {
    if (drop.itemId === undefined) return drop;
    const facts = factsOf(drop.itemId);
    if (!facts) return drop;
    // Icon and quality come across whatever happens to the name — they are the
    // item's, never the drop table's, and a row keeping its written name still
    // renders as the item it points at.
    const withArt = { ...drop, quality: facts.quality, icon: facts.icon };
    const real = facts.name;
    if (!real || real === drop.itemName) return withArt;
    if ((resolvedCount.get(`${drop.bossKey}|${real.toLowerCase()}`) ?? 0) > 1) {
      // Keep what was written, and say what it resolves to, so the row is still
      // traceable to an item without becoming indistinguishable from its twin.
      return { ...withArt, resolvedName: real };
    }
    return { ...withArt, itemName: real, writtenName: drop.itemName };
  });
}

/** The merged table grouped the way a plan reads it. */
export function dropsByBoss(drops: MergedDrop[]): Map<string, MergedDrop[]> {
  const out = new Map<string, MergedDrop[]>();
  for (const drop of drops) {
    out.set(drop.bossKey, [...(out.get(drop.bossKey) ?? []), drop]);
  }
  return out;
}
