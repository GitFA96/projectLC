import type {
  AwardWithContext,
  Character,
  ContentionWisher,
  GearSet,
  Item,
  ItemContention,
  Phase,
  SlotItem,
} from "@/lib/types";
import { SLOT_FAMILIES } from "@/lib/constants/wow";
import { itemDisplayName } from "@/lib/items/item-data";

interface ContentionInput {
  itemId: number;
  item?: Item;
  characters: Character[];
  gearSetsByCharacter: Map<string, GearSet[]>;
  awards: AwardWithContext[]; // all awards, with context
  activePhase: Phase;
}

/**
 * For one item: who has it wishlisted (and are they satisfied), and who won it.
 * The LC's "should this drop go to X?" view.
 */
export function computeItemContention(input: ContentionInput): ItemContention {
  const { itemId, item, characters, gearSetsByCharacter, awards, activePhase } = input;

  const itemAwards = awards
    .filter((a) => a.award.itemId === itemId)
    .sort((a, b) => b.award.awardedAt.localeCompare(a.award.awardedAt));

  const wishers: ContentionWisher[] = [];
  for (const character of characters) {
    const sets = gearSetsByCharacter.get(character.id) ?? [];
    const wishlists = sets.filter((s) => s.kind === "wishlist");
    const wishedIn = wishlists.filter((w) => w.slots.some((s) => s.itemId === itemId));
    if (wishedIn.length === 0) continue;

    const phases = wishedIn
      .map((w) => w.phase)
      .filter((p): p is Phase => p !== undefined)
      .sort((a, b) => a - b);

    // What do they currently run in that slot family?
    const wishedSlot = wishedIn[0].slots.find((s) => s.itemId === itemId)?.slot;
    const current = sets.find((s) => s.kind === "current");
    let currentInSlot: SlotItem[] = [];
    if (current && wishedSlot) {
      const family = SLOT_FAMILIES[wishedSlot];
      currentInSlot = current.slots.filter((s) =>
        family ? SLOT_FAMILIES[s.slot] === family : s.slot === wishedSlot,
      );
    }

    const equipped = current?.slots.some((s) => s.itemId === itemId) ?? false;
    const awarded = itemAwards.some(
      (a) => a.award.characterId === character.id && !a.award.offspec,
    );
    const onSpecAwardsActivePhase = awards.filter(
      (a) =>
        a.award.characterId === character.id &&
        !a.award.offspec &&
        a.sessionPhase === activePhase,
    ).length;

    wishers.push({
      character,
      phases,
      currentInSlot,
      satisfied: equipped || awarded,
      onSpecAwardsActivePhase,
    });
  }

  // Open (unsatisfied) wishers first, then by fewest recent awards — LC priority order.
  wishers.sort((a, b) => {
    if (a.satisfied !== b.satisfied) return a.satisfied ? 1 : -1;
    return a.onSpecAwardsActivePhase - b.onSpecAwardsActivePhase;
  });

  return {
    item,
    itemId,
    itemName: itemDisplayName(itemId, item?.name, itemAwards[0]?.award.itemName),
    wishers,
    awards: itemAwards,
    openCount: wishers.filter((w) => !w.satisfied).length,
  };
}
