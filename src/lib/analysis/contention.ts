import type {
  AwardWithContext,
  Character,
  ContenderAward,
  ContentionWisher,
  GearSet,
  Item,
  ItemContention,
  ItemPriorityRule,
  Phase,
  RaiderMetrics,
  SlotId,
  SlotItem,
} from "@/lib/types";
import { SLOT_FAMILIES, slotFamilyMembers } from "@/lib/constants/wow";
import { rankLootContenders } from "@/lib/analysis/loot-priority";
import type { GuildPolicy } from "@/lib/analysis/policy";
import { manualTiers, parsePriorityChain, tierFor } from "@/lib/loot/priority-chain";
import { itemDisplayName } from "@/lib/items/item-data";

interface ContentionInput {
  itemId: number;
  item?: Item;
  characters: Character[];
  gearSetsByCharacter: Map<string, GearSet[]>;
  awards: AwardWithContext[]; // all awards, with context
  activePhase: Phase;
  /** The raiding record behind each contender's priority score. */
  metricsOf?: (characterId: string) => RaiderMetrics | undefined;
  /** The council's spec priority for this item, when the sheet covers it. */
  priorityRule?: ItemPriorityRule;
  /** The council's policy; omitted means the code defaults are in force. */
  policy?: GuildPolicy;
}

const familyKey = (slot: SlotId): string => SLOT_FAMILIES[slot] ?? slot;

/**
 * Which slot an awarded item goes in. The item cache knows for anything
 * resolved from Wowhead; failing that, any of the winner's own lists that name
 * the item says so — a wishlist slot is typed by a person and exact.
 */
function slotOfAward(itemId: number, item: Item | undefined, sets: GearSet[]): SlotId | undefined {
  if (item?.slot) return item.slot;
  for (const set of sets) {
    const match = set.slots.find((s) => s.itemId === itemId);
    if (match) return match.slot;
  }
  return undefined;
}

/**
 * For one item: who has it wishlisted (and are they satisfied), and who won it.
 * The LC's "should this drop go to X?" view.
 */
export function computeItemContention(input: ContentionInput): ItemContention {
  const { itemId, item, characters, gearSetsByCharacter, awards, activePhase, metricsOf } = input;
  // The council's written chain for this item, parsed once for every contender.
  const chain = input.priorityRule ? parsePriorityChain(input.priorityRule.chain) : undefined;

  const itemAwards = awards
    .filter((a) => a.award.itemId === itemId)
    .sort((a, b) => b.award.awardedAt.localeCompare(a.award.awardedAt));

  const wishers: ContentionWisher[] = [];
  // Alts don't contend. An alt's wishlist is a real statement of want, but the
  // council awards to the person's main — ranking one against the mains would
  // put an alt above a raider who shows up on theirs. They're counted so the
  // item page can say the list exists, and left out of the contest entirely.
  const altWishers: string[] = [];
  // The slot the drop fills: the cache when it knows, otherwise the first list
  // that names the item — which is typed by a person and exact.
  let contestedSlot: SlotId | undefined = item?.slot ?? undefined;
  for (const character of characters) {
    const sets = gearSetsByCharacter.get(character.id) ?? [];
    const wishlists = sets.filter((s) => s.kind === "wishlist");
    const wishedIn = wishlists.filter((w) => w.slots.some((s) => s.itemId === itemId));
    if (wishedIn.length === 0) continue;
    if (character.status === "alt") {
      altWishers.push(character.name);
      continue;
    }

    const phases = wishedIn
      .map((w) => w.phase)
      .filter((p): p is Phase => p !== undefined)
      .sort((a, b) => a - b);

    // What do they currently run in that slot family?
    const wishedSlot = wishedIn[0].slots.find((s) => s.itemId === itemId)?.slot;
    contestedSlot ??= wishedSlot;
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

    // Everything they've been handed this phase, tagged with the slot it fills
    // — the item that just dropped competes with the belt they won last week,
    // not only with the same item id.
    const mine = awards.filter((a) => a.award.characterId === character.id);
    const awardsThisPhase: ContenderAward[] = mine
      .filter((a) => a.sessionPhase === activePhase)
      .map((a) => {
        const slot = slotOfAward(a.award.itemId, a.item, sets);
        return {
          itemId: a.award.itemId,
          itemName: a.item?.name ?? a.award.itemName,
          awardedAt: a.award.awardedAt,
          offspec: a.award.offspec,
          slot,
          // The contested item itself is already handled by `satisfied` — this
          // is about the OTHER things filling the same slot.
          sameSlot:
            a.award.itemId !== itemId &&
            slot !== undefined &&
            wishedSlot !== undefined &&
            familyKey(slot) === familyKey(wishedSlot),
        };
      })
      .sort((a, b) => b.awardedAt.localeCompare(a.awardedAt));

    const tier = chain ? tierFor(chain, character) : {};
    wishers.push({
      character,
      phases,
      currentInSlot,
      satisfied: equipped || awarded,
      onSpecAwardsActivePhase: awardsThisPhase.filter((a) => !a.offspec).length,
      awardsThisPhase,
      totalOnSpecAwards: mine.filter((a) => !a.award.offspec).length,
      priorityTier: tier.index,
      priorityTierLabel: tier.label,
    });
  }

  // Open (unsatisfied) contenders first, in council priority order; satisfied
  // ones keep their place in the list but are ranked out of the contest. The
  // family size tells the ranking how many of this slot a raider can wear —
  // one belt, but two rings — before a second one counts against them.
  const ranked = rankLootContenders(wishers, metricsOf ?? (() => undefined), {
    familySize: contestedSlot ? slotFamilyMembers(contestedSlot).length : 1,
    policy: input.policy,
  });

  return {
    item,
    itemId,
    itemName: itemDisplayName(itemId, item?.name, itemAwards[0]?.award.itemName),
    wishers: ranked,
    awards: itemAwards,
    openCount: ranked.filter((w) => !w.satisfied).length,
    altWishers: altWishers.sort((a, b) => a.localeCompare(b)),
    priorityRule: input.priorityRule,
    manualTiers: chain ? manualTiers(chain) : [],
  };
}
