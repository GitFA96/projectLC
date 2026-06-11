import { slotItemSchema, statBlockSchema } from "@/lib/import/schemas";
import { PHASE_IDS, SLOT_IDS, type Phase, type SlotId } from "@/lib/constants/wow";
import type { SlotItem, StatBlock } from "@/lib/types";

/**
 * SixtyUpgrades set-export parser, built against a real export
 * (__fixtures__/sixtyupgrades-fury-warrior.json): the slot list is `items`
 * with UPPER_SNAKE slot names (FINGER_1, MAIN_HAND…), the character block
 * carries `gameClass`/`race` in caps, and the set's `phase` rides along.
 * Tolerant by design — unknown fields are ignored, slot names go through
 * aliases, and anything skipped becomes a warning instead of failing the
 * import. Pure module, shared by the client preview and the server commit.
 */

export interface ParsedSixtyUpgrades {
  setName?: string;
  character?: { name?: string; class?: string; spec?: string; race?: string };
  /** The phase the set was built for, when the export carries one. */
  phase?: Phase;
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

/** "WARRIOR" → "Warrior", "BLOOD_ELF" → "Blood Elf" — display casing for caps enums. */
function titleCase(v: string | undefined): string | undefined {
  if (!v) return undefined;
  return v
    .toLowerCase()
    .split(/[\s_]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
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

  // Real exports call the slot list `items`; accept `slots` for hand-written data.
  const slotList = (r: Record<string, unknown> | undefined): unknown[] | undefined =>
    Array.isArray(r?.items) ? r.items : Array.isArray(r?.slots) ? r.slots : undefined;

  // Tolerate "export all sets" wrappers: { sets: [...] } or { set: {...} }.
  if (root && !slotList(root)) {
    if (Array.isArray(root.sets) && root.sets.length > 0) {
      if (root.sets.length > 1) {
        warnings.push(`Export contains ${root.sets.length} sets — using the first. Import one set at a time.`);
      }
      root = asRecord(root.sets[0]);
    } else if (asRecord(root.set)) {
      root = asRecord(root.set);
    }
  }
  const rawSlots = slotList(root);
  if (!root || !rawSlots) {
    return { ok: false, error: "JSON has no `items` array — is this a SixtyUpgrades set export?" };
  }

  const slots: SlotItem[] = [];
  const seenSlots = new Set<SlotId>();
  rawSlots.forEach((rawSlot, i) => {
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
        class: titleCase(asString(rawCharacter.gameClass) ?? asString(rawCharacter.class)),
        spec: asString(rawCharacter.spec),
        race: titleCase(asString(rawCharacter.race)),
      }
    : undefined;

  const phase =
    typeof root.phase === "number" && (PHASE_IDS as readonly number[]).includes(root.phase)
      ? (root.phase as Phase)
      : undefined;

  return {
    ok: true,
    parsed: {
      setName: asString(root.name),
      character,
      phase,
      stats: statBlockSchema.parse(stats),
      slots,
      warnings,
    },
  };
}
