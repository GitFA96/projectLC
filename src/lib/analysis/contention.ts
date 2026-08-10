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
import type { WishlistAlternative } from "@/lib/analysis/wishlist-alternatives";
import { SLOT_FAMILIES, slotFamilyMembers } from "@/lib/constants/wow";
import { rankLootContenders } from "@/lib/analysis/loot-priority";
import type { GuildPolicy } from "@/lib/analysis/policy";
import { manualTiers, parsePriorityChain, tierFor } from "@/lib/loot/priority-chain";
import { itemDisplayName } from "@/lib/items/item-data";
import { NO_TOKEN_REDEMPTIONS, type TokenRedemptions } from "@/lib/items/tier-tokens";

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
  /**
   * Ranked fallbacks per raider — "if my BiS doesn't drop, I'll take this".
   *
   * These put somebody on the board who the imported wishlist never would: the
   * set names one item per slot, so without this a raider whose second choice
   * drops is invisible to the council. What the rank does NOT do is move the
   * score. Whether a second choice should stand aside for a BiS wisher depends
   * on the raider's other options and what those block, which the council
   * decided is judgement rather than arithmetic — so the rank is shown and the
   * argument goes in the item's notes.
   */
  alternatives?: WishlistAlternative[];
  /** The council's policy; omitted means the code defaults are in force. */
  policy?: GuildPolicy;
  /**
   * Lets an armor token stand for the tier pieces it buys, in both directions
   * of the board: the token's own page finds everyone who listed a piece, and
   * a piece's page finds the token award that bought it.
   */
  redemptions?: TokenRedemptions;
}

const familyKey = (slot: SlotId): string => SLOT_FAMILIES[slot] ?? slot;

/**
 * Which slot an awarded item goes in. The item cache knows for anything
 * resolved from Wowhead; failing that, any of the winner's own lists that name
 * the item says so — a wishlist slot is typed by a person and exact.
 */
function slotOfAward(
  itemId: number,
  item: Item | undefined,
  sets: GearSet[],
  redemptions: TokenRedemptions,
): SlotId | undefined {
  if (item?.slot) return item.slot;
  // An armor token has no slot of its own — Wowhead says so, it isn't a gap in
  // the cache — so the only thing that can type it is the piece it buys, which
  // is named in a list typed by a person.
  for (const set of sets) {
    const match = set.slots.find((s) => redemptions.delivers(itemId, s.itemId));
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
  const redemptions = input.redemptions ?? NO_TOKEN_REDEMPTIONS;
  // The council's written chain for this item, parsed once for every contender.
  const chain = input.priorityRule ? parsePriorityChain(input.priorityRule.chain) : undefined;

  // Both directions: the token's page shows the token awards, and a tier
  // piece's page shows the token award that bought it.
  const itemAwards = awards
    .filter((a) => redemptions.delivers(a.award.itemId, itemId))
    .sort((a, b) => b.award.awardedAt.localeCompare(a.award.awardedAt));

  const wishers: ContentionWisher[] = [];
  // Alts contend only when the council says so (policy.loot.altsContend).
  //
  // Off by default: an alt's wishlist is a real statement of want, but loot
  // goes to the person's main, so ranking an alt among the mains would put them
  // above a raider who turns up on theirs. They're named beneath the board
  // instead — visible, not scored.
  //
  // This can't be a display toggle. Letting alts into the contest moves
  // everyone's "loot owed", because the most-fed contender sets the scale.
  const altsContend = input.policy?.loot.altsContend ?? false;
  const altWishers: string[] = [];
  // Ranked fallbacks naming this item, per raider.
  const fallbacksByCharacter = new Map<string, WishlistAlternative[]>();
  for (const a of input.alternatives ?? []) {
    if (a.itemId !== itemId) continue;
    const list = fallbacksByCharacter.get(a.characterId) ?? [];
    list.push(a);
    fallbacksByCharacter.set(a.characterId, list);
  }
  // The slot the drop fills: the cache when it knows, otherwise the first list
  // that names the item — which is typed by a person and exact.
  let contestedSlot: SlotId | undefined = item?.slot ?? undefined;
  for (const character of characters) {
    const sets = gearSetsByCharacter.get(character.id) ?? [];
    const wishlists = sets.filter((s) => s.kind === "wishlist");
    const wishedIn = wishlists.filter((w) =>
      w.slots.some((s) => redemptions.delivers(itemId, s.itemId)),
    );
    const fallbacks = fallbacksByCharacter.get(character.id) ?? [];
    if (wishedIn.length === 0 && fallbacks.length === 0) continue;
    if (character.status === "alt" && !altsContend) {
      altWishers.push(character.name);
      continue;
    }

    // Where this sits on their list: 0 when the imported set names it — one
    // item per slot, so that is their BiS — otherwise the best rank they gave
    // it as a fallback.
    const listRank =
      wishedIn.length > 0 ? 0 : Math.min(...fallbacks.map((f) => f.rank));

    const phases = [
      ...new Set([
        ...wishedIn.map((w) => w.phase).filter((p): p is Phase => p !== undefined),
        ...fallbacks.map((f) => f.phase),
      ]),
    ].sort((a, b) => a - b);

    // What do they currently run in that slot family? The imported set types
    // the slot when it names the item; a fallback carries its own.
    const wishedSlot =
      wishedIn[0]?.slots.find((s) => redemptions.delivers(itemId, s.itemId))?.slot ??
      fallbacks[0]?.slot;
    contestedSlot ??= wishedSlot;
    const current = sets.find((s) => s.kind === "current");
    let currentInSlot: SlotItem[] = [];
    if (current && wishedSlot) {
      const family = SLOT_FAMILIES[wishedSlot];
      currentInSlot = current.slots.filter((s) =>
        family ? SLOT_FAMILIES[s.slot] === family : s.slot === wishedSlot,
      );
    }

    // Wearing the piece a token buys settles the token too — they went to the
    // vendor, and no drop of it can help them now.
    const equipped = current?.slots.some((s) => redemptions.delivers(itemId, s.itemId)) ?? false;
    const awarded = itemAwards.some(
      (a) => a.award.characterId === character.id && !a.award.offspec,
    );

    // Everything they've been handed this phase, tagged with the slot it fills
    // — the item that just dropped competes with the belt they won last week,
    // not only with the same item id.
    const mine = awards.filter((a) => a.award.characterId === character.id);
    // Everything their lists name, so an award can be told apart from a filler.
    // Item ids are exact; no slot matching, and none of the ring/trinket
    // ambiguity that comes with it.
    //
    // Across every phase, deliberately. Scoping this to the active phase looks
    // tidier and is wrong: this guild is on P2 with P3 lists imported, so it
    // found nothing for anybody and read the whole roster as never having asked
    // for a single item they won. "Did they want this" doesn't expire when the
    // guild moves tier — and the wisher check above has never been phase-scoped
    // either, so scoping this one made the two disagree.
    const wanted = new Set(wishlists.flatMap((w) => w.slots.map((s) => s.itemId)));
    const fallbackRank = new Map(
      (input.alternatives ?? [])
        .filter((a) => a.characterId === character.id)
        .map((a) => [a.itemId, a.rank] as const),
    );
    // Whether we can answer the question at all. A raider with no list on
    // record isn't someone who asked for nothing; we simply don't know, and
    // treating that as "off-list" would hand them a discount for not having
    // imported a wishlist.
    const hasAnyList = wishlists.length > 0 || fallbackRank.size > 0;
    // What an award delivers off this raider's own lists. An armor token is on
    // nobody's list — the piece it buys is — so matching the awarded id alone
    // read every tier win as something they never asked for, which under the
    // council's `offListDrop` of zero cost the winner nothing whatsoever.
    const listedIds = [...wanted, ...fallbackRank.keys()];
    const listedItemFor = (awardItemId: number): number | undefined =>
      wanted.has(awardItemId) || fallbackRank.has(awardItemId)
        ? awardItemId
        : redemptions.piecesAmong(awardItemId, listedIds)[0];
    const awardsThisPhase: ContenderAward[] = mine
      .filter((a) => a.sessionPhase === activePhase)
      .map((a) => {
        const slot = slotOfAward(a.award.itemId, a.item, sets, redemptions);
        const listed = listedItemFor(a.award.itemId);
        return {
          itemId: a.award.itemId,
          itemName: a.item?.name ?? a.award.itemName,
          awardedAt: a.award.awardedAt,
          offspec: a.award.offspec,
          slot,
          // The contested item itself is already handled by `satisfied` — this
          // is about the OTHER things filling the same slot.
          sameSlot:
            !redemptions.delivers(a.award.itemId, itemId) &&
            slot !== undefined &&
            wishedSlot !== undefined &&
            familyKey(slot) === familyKey(wishedSlot),
          listRank: listed === undefined ? undefined : wanted.has(listed) ? 0 : fallbackRank.get(listed),
          notListed: hasAnyList && listed === undefined,
        };
      })
      .sort((a, b) => b.awardedAt.localeCompare(a.awardedAt));

    const tier = chain ? tierFor(chain, character) : {};
    wishers.push({
      character,
      phases,
      listRank,
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
