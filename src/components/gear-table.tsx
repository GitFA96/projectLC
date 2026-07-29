import { ENCHANTABLE_GEAR_SLOTS } from "@/lib/wcl/consumables";
import { GEAR_SLOT_LABELS, wowheadEnchantSearchUrl, wowheadItemUrl } from "@/lib/wcl/enchants";
import { QUALITY_TEXT_COLORS } from "@/lib/constants/wow";
import { itemDisplayName, normalizeIcon } from "@/lib/items/item-data";
import { gradeEnchant, type EnchantGrade, type EnchantRef, type EnchantReference } from "@/lib/analysis/enchants";
import type { GearSet, Item, Quality, WclGearItem, WowClass } from "@/lib/types";
import { ItemIcon } from "@/components/item-icon";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * One worn-gear snapshot as a table: what was in each slot on a given pull,
 * with the enchant judged and the gems named.
 *
 * Shared by the performance page (the pull you're reading) and the character
 * profile (the boss you picked), so "gear worn" means the same thing and looks
 * the same wherever it appears.
 */

/**
 * External Wowhead-linked item (worn gear and gems live outside the item
 * pages). The hover tooltip is given the enchant and the socketed gems, so it
 * renders the item exactly as it was worn — which is the only place an
 * enchant's real name shows up: Wowhead has no page for enchantment ids.
 */
export function WornItemLink({
  gearItem,
  cached,
  size = 20,
}: {
  gearItem: { id: number; name?: string; icon?: string; quality?: Quality; enchant?: number; gems?: { id: number }[] };
  cached?: Item;
  size?: number;
}) {
  const name = itemDisplayName(gearItem.id, gearItem.name, cached?.name);
  const quality = gearItem.quality ?? cached?.quality;
  const gems = (gearItem.gems ?? []).map((g) => g.id).join(":");
  const tooltip = [
    `item=${gearItem.id}`,
    gearItem.enchant !== undefined ? `ench=${gearItem.enchant}` : undefined,
    gems ? `gems=${gems}` : undefined,
    "domain=tbc",
  ]
    .filter(Boolean)
    .join("&");
  return (
    <a
      href={wowheadItemUrl(gearItem.id)}
      target="_blank"
      rel="noreferrer"
      data-wowhead={tooltip}
      className="inline-flex min-w-0 items-center gap-1.5 hover:underline"
    >
      <ItemIcon
        icon={normalizeIcon(gearItem.icon) ?? cached?.icon}
        quality={quality ?? "common"}
        size={size}
      />
      <span
        className="truncate text-sm font-medium"
        style={quality ? { color: QUALITY_TEXT_COLORS[quality] } : undefined}
      >
        {name}
      </span>
    </a>
  );
}

/**
 * One socketed gem: its icon comes from the log, its name from the item cache
 * (filled by the import page's backfill). An unnamed gem shows its id rather
 * than a fake name — the icon and the hover tooltip still identify it.
 */
function GemChip({ gem, cached }: { gem: { id: number; icon?: string }; cached?: Item }) {
  const quality = cached?.quality;
  return (
    <a
      href={wowheadItemUrl(gem.id)}
      target="_blank"
      rel="noreferrer"
      data-wowhead={`item=${gem.id}&domain=tbc`}
      className="inline-flex min-w-0 items-center gap-1 hover:underline"
      title={cached?.name ?? `Gem ${gem.id} — hover for the Wowhead tooltip`}
    >
      <ItemIcon icon={normalizeIcon(gem.icon) ?? cached?.icon} quality={quality ?? "common"} size={16} />
      {cached?.name ? (
        <span
          className="truncate text-xs"
          style={quality ? { color: QUALITY_TEXT_COLORS[quality] } : undefined}
        >
          {cached.name}
        </span>
      ) : (
        <span className="truncate text-xs tabular-nums text-muted-foreground">#{gem.id}</span>
      )}
    </a>
  );
}

/**
 * The enchant on a worn item, named and judged.
 *
 * Names come from the guild's own imported sets (the only source that maps an
 * enchantment id to a name — see lib/analysis/enchants), and the verdict is
 * only ever stated against a real reference: the raider's own list, or what
 * their class's other lists picked for that slot. An enchant nobody's list has
 * named stays an id rather than becoming a guess.
 */
function EnchantCell({ grade, itemsById }: { grade: EnchantGrade; itemsById: Map<number, Item> }) {
  const { verdict, worn, wanted, source, agreement } = grade;

  if (verdict === "not-enchantable") return <span className="text-muted-foreground/50">—</span>;

  if (verdict === "missing") {
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium text-destructive">missing</span>
        {wanted && (
          <span className="text-xs text-muted-foreground">
            wants <EnchantName enchant={wanted} itemsById={itemsById} />
            <SourceNote source={source} agreement={agreement} />
          </span>
        )}
      </span>
    );
  }

  if (!worn) return <span className="text-muted-foreground/50">—</span>;

  // An id nobody's list has named yet: say exactly that, and point at the fix.
  if (!worn.name) {
    return (
      <span
        className="text-xs text-muted-foreground"
        title="No imported set names this enchant. Hover the item for Wowhead's tooltip, or import a set that uses it."
      >
        unnamed enchant <span className="tabular-nums">#{worn.id}</span>
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <EnchantName enchant={worn} itemsById={itemsById} />
      {verdict === "bis" && (
        <Badge variant="success" className="font-normal">
          BiS
          <SourceNote source={source} agreement={agreement} />
        </Badge>
      )}
      {verdict === "off-bis" && wanted && (
        <span className="text-xs text-amber-700">
          list wants <EnchantName enchant={wanted} itemsById={itemsById} />
          <SourceNote source={source} agreement={agreement} />
        </span>
      )}
    </span>
  );
}

/** Enchant name with the icon of the item that applies it, when there is one. */
function EnchantName({ enchant, itemsById }: { enchant: EnchantRef; itemsById: Map<number, Item> }) {
  const cached = enchant.itemId !== undefined ? itemsById.get(enchant.itemId) : undefined;
  const label = enchant.name || `#${enchant.id}`;
  return (
    <a
      href={
        enchant.itemId !== undefined ? wowheadItemUrl(enchant.itemId) : wowheadEnchantSearchUrl(label)
      }
      target="_blank"
      rel="noreferrer"
      {...(enchant.itemId !== undefined ? { "data-wowhead": `item=${enchant.itemId}&domain=tbc` } : {})}
      className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
    >
      {cached?.icon && <ItemIcon icon={cached.icon} quality={cached.quality ?? "common"} size={14} />}
      <span>{label}</span>
    </a>
  );
}

/** Where a "wants" came from — their list, or how many of the class's lists agree. */
function SourceNote({
  source,
  agreement,
}: {
  source?: "own-list" | "guild-lists";
  agreement?: { sets: number; totalSets: number };
}) {
  if (source === "own-list") return <span className="ml-1 opacity-70">(their list)</span>;
  if (source === "guild-lists" && agreement) {
    return (
      <span className="ml-1 opacity-70">
        ({agreement.sets}/{agreement.totalSets} class lists)
      </span>
    );
  }
  return null;
}

export function GearTable({
  gear,
  itemsById,
  wowClass,
  ownWishlists,
  enchants,
  /** Slot indexes worn differently on the most recent snapshot — marked "swap". */
  swappedSlots,
}: {
  gear: WclGearItem[];
  itemsById: Map<number, Item>;
  wowClass: WowClass;
  /** The character's own wishlists — the first reference for "is this BiS". */
  ownWishlists: GearSet[];
  enchants: EnchantReference;
  swappedSlots?: Set<number>;
}) {
  const expectedEnchant = new Set(ENCHANTABLE_GEAR_SLOTS.map((s) => s.index));
  const bySlot = new Map(gear.map((g) => [g.slot, g] as const));

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-24">Slot</TableHead>
          <TableHead>Item</TableHead>
          <TableHead className="w-16 text-right">ilvl</TableHead>
          <TableHead className="w-56">Enchant</TableHead>
          <TableHead>Gems</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {GEAR_SLOT_LABELS.flatMap(({ index, label }) => {
          const g = bySlot.get(index);
          if (!g) return [];
          const isWeapon = index === 15;
          const expectsEnchant = expectedEnchant.has(index);
          return [
            <TableRow key={index}>
              <TableCell
                className={cn(
                  "text-xs uppercase tracking-wide text-muted-foreground",
                  isWeapon && "font-semibold text-foreground",
                )}
              >
                {label}
              </TableCell>
              <TableCell>
                <span className="flex min-w-0 items-center gap-1.5">
                  <WornItemLink gearItem={g} cached={itemsById.get(g.id)} />
                  {swappedSlots?.has(index) && (
                    <Badge
                      variant="muted"
                      className="shrink-0 px-1 py-0 text-[10px] font-normal"
                      title="Not what they wore on their most recent pull — a swap for this boss"
                    >
                      swap
                    </Badge>
                  )}
                </span>
              </TableCell>
              <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                {g.ilvl ?? "—"}
              </TableCell>
              <TableCell className="text-sm">
                <EnchantCell
                  grade={gradeEnchant({
                    slotIndex: index,
                    wornEnchantId: g.enchant,
                    enchantable: expectsEnchant,
                    wowClass,
                    ownWishlists,
                    reference: enchants,
                  })}
                  itemsById={itemsById}
                />
                {isWeapon && (
                  <p
                    className={cn(
                      "mt-0.5 text-xs",
                      g.temp !== undefined ? "text-emerald-700" : "font-medium text-amber-600",
                    )}
                  >
                    {g.temp !== undefined
                      ? "temp buff up on this pull"
                      : "no temp buff on this pull"}
                  </p>
                )}
              </TableCell>
              <TableCell>
                {g.gems.length > 0 ? (
                  <span className="flex flex-col gap-0.5">
                    {g.gems.map((gem, i) => (
                      <GemChip key={`${gem.id}-${i}`} gem={gem} cached={itemsById.get(gem.id)} />
                    ))}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground/50">—</span>
                )}
              </TableCell>
            </TableRow>,
          ];
        })}
      </TableBody>
    </Table>
  );
}
