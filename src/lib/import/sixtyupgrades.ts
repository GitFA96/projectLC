import { slotItemSchema, statBlockSchema } from "@/lib/import/schemas";
import { SLOT_IDS, type SlotId } from "@/lib/constants/wow";
import type { SlotItem, StatBlock } from "@/lib/types";

/**
 * SixtyUpgrades set-export parser. Tolerant by design: the export schema is
 * community-observed rather than documented, so unknown fields are ignored,
 * slot names are mapped through aliases, and anything skipped is reported as
 * a warning instead of failing the whole import. Pure module — used by the
 * client-side preview and the server-side commit alike.
 */

export interface ParsedSixtyUpgrades {
  setName?: string;
  character?: { name?: string; class?: string; spec?: string; race?: string };
  stats: StatBlock;
  slots: SlotItem[];
  warnings: string[];
}

export type SixtyUpgradesParseResult =
  | { ok: true; parsed: ParsedSixtyUpgrades }
  | { ok: false; error: string };

const SLOT_ALIASES: Record<string, SlotId> = {
  helm: "head", helmet: "head",
  necklace: "neck", amulet: "neck",
  shoulders: "shoulder",
  cloak: "back", cape: "back",
  robe: "chest",
  wrists: "wrist", bracer: "wrist", bracers: "wrist",
  hand: "hands", glove: "hands", gloves: "hands",
  belt: "waist",
  leggings: "legs", pants: "legs",
  boots: "feet", foot: "feet",
  finger1: "ring1", finger2: "ring2",
  weapon: "mainHand", mainhand1: "mainHand", twohand: "mainHand",
  shield: "offHand", heldinoffhand: "offHand", offhand1: "offHand",
  wand: "ranged", relic: "ranged", idol: "ranged", libram: "ranged", totem: "ranged",
  bow: "ranged", gun: "ranged", thrown: "ranged",
};

const CANONICAL_SLOTS = new Map<string, SlotId>(SLOT_IDS.map((s) => [s.toLowerCase(), s]));

function normalizeSlotName(raw: unknown): SlotId | undefined {
  if (typeof raw !== "string") return undefined;
  const key = raw.toLowerCase().replace(/[\s_-]+/g, "");
  return CANONICAL_SLOTS.get(key) ?? SLOT_ALIASES[key];
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

/** Map one raw slot entry to the canonical SlotItem shape (field aliases included). */
function normalizeSlotEntry(raw: unknown): unknown {
  const entry = asRecord(raw);
  if (!entry) return raw;
  const item = asRecord(entry.item);
  const slot = normalizeSlotName(entry.slot ?? entry.slotName ?? item?.slot);
  const itemId = entry.itemId ?? item?.id ?? entry.id;
  const itemName = entry.itemName ?? item?.name ?? entry.name;
  const rawEnchant = entry.enchant ?? item?.enchant;
  const enchant =
    asString(rawEnchant) !== undefined
      ? { name: asString(rawEnchant)! }
      : asRecord(rawEnchant) && asString(asRecord(rawEnchant)!.name)
        ? { id: asRecord(rawEnchant)!.id as number | undefined, name: asString(asRecord(rawEnchant)!.name)! }
        : undefined;
  const rawGems = entry.gems ?? item?.gems;
  const gems = Array.isArray(rawGems)
    ? rawGems
        .map((g) => (asString(g) !== undefined ? { name: asString(g)! } : g))
        .filter((g) => asRecord(g) && asString(asRecord(g)!.name) !== undefined)
    : undefined;
  return {
    slot,
    itemId: typeof itemId === "string" && /^\d+$/.test(itemId) ? Number(itemId) : itemId,
    itemName,
    ...(enchant ? { enchant } : {}),
    ...(gems && gems.length > 0 ? { gems } : {}),
  };
}

export function parseSixtyUpgradesExport(text: string): SixtyUpgradesParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "Not valid JSON — paste the raw SixtyUpgrades set export." };
  }

  const warnings: string[] = [];
  let root = asRecord(json);

  // Tolerate "export all sets" wrappers: { sets: [...] } or { set: {...} }.
  if (root && !Array.isArray(root.slots)) {
    if (Array.isArray(root.sets) && root.sets.length > 0) {
      if (root.sets.length > 1) {
        warnings.push(`Export contains ${root.sets.length} sets — using the first. Import one set at a time.`);
      }
      root = asRecord(root.sets[0]);
    } else if (asRecord(root.set)) {
      root = asRecord(root.set);
    }
  }
  if (!root || !Array.isArray(root.slots)) {
    return { ok: false, error: "JSON has no `slots` array — is this a SixtyUpgrades set export?" };
  }

  const slots: SlotItem[] = [];
  const seenSlots = new Set<SlotId>();
  root.slots.forEach((rawSlot, i) => {
    const parsed = slotItemSchema.safeParse(normalizeSlotEntry(rawSlot));
    if (!parsed.success) {
      const slotHint = asRecord(rawSlot)?.slot;
      warnings.push(
        `Slot entry ${i + 1}${typeof slotHint === "string" ? ` (“${slotHint}”)` : ""} skipped: ${parsed.error.issues[0]?.message ?? "invalid shape"}.`,
      );
      return;
    }
    if (seenSlots.has(parsed.data.slot)) {
      warnings.push(`Duplicate ${parsed.data.slot} entry skipped (kept the first).`);
      return;
    }
    seenSlots.add(parsed.data.slot);
    slots.push(parsed.data);
  });
  if (slots.length === 0) {
    return { ok: false, error: "No valid slot entries found in the export." };
  }

  const stats: StatBlock = {};
  const rawStats = asRecord(root.stats) ?? asRecord(asRecord(root.summary)?.stats);
  if (rawStats) {
    for (const [key, value] of Object.entries(rawStats)) {
      if (typeof value === "number" && Number.isFinite(value)) stats[key] = value;
      else warnings.push(`Stat “${key}” ignored (not a number).`);
    }
  } else {
    warnings.push("Export has no stats block — the “upcoming stats” comparison will be empty for this set.");
  }

  const rawCharacter = asRecord(root.character);
  const character = rawCharacter
    ? {
        name: asString(rawCharacter.name),
        class: asString(rawCharacter.class),
        spec: asString(rawCharacter.spec),
        race: asString(rawCharacter.race),
      }
    : undefined;

  return {
    ok: true,
    parsed: {
      setName: asString(root.name),
      character,
      stats: statBlockSchema.parse(stats),
      slots,
      warnings,
    },
  };
}
