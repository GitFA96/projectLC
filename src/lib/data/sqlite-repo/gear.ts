import { randomUUID } from "node:crypto";
import {
  bumpDataVersion,
  getDb,
  insertCurrentGearOverride,
  insertGearSet,
  mergeItems,
  withTx,
} from "@/lib/data/db";
import { harvestItemFacts } from "@/lib/items/item-data";
import { currentGearOverrideSchema, gearSetSchema } from "@/lib/import/schemas";
import type {
  GearSetDraft,
  SetCurrentGearOverrideResult,
  SetCurrentGearOverridesResult,
  UpsertGearSetResult,
  WriteRepo,
} from "@/lib/data/repo";
import type {
  CurrentGearOverride,
  GearOverrideSource,
  GearSet,
  GearSpec,
  SlotId,
  SlotItem,
} from "@/lib/types";
import { readModel, findExisting } from "./model";
import type { Writes } from "./model";

/**
 * Gear sets and the manual overrides on top of them.
 *
 * A set is what SixtyUpgrades exported; an override is an officer saying the
 * export is wrong about one slot. They are separate tables keyed differently —
 * an override is keyed by character, spec and slot, not by set — so replacing
 * an export leaves the corrections standing, which is the point of making one.
 */

export const gearWrites = {
  async findExistingSet(characterId, kind, phase) {
    return findExisting(characterId, kind, phase);
  },

  async upsertGearSet(draft: GearSetDraft, opts: { replace: boolean }): Promise<UpsertGearSetResult> {
    const db = getDb();
    const set = gearSetSchema.parse({
      ...draft,
      id: `gs_${randomUUID()}`,
      importedAt: new Date().toISOString(),
    } satisfies GearSet);

    const existing = findExisting(draft.characterId, draft.kind, draft.phase);
    if (existing && !opts.replace) return { status: "exists", existing };

    withTx(db, () => {
      if (existing) db.prepare("DELETE FROM gear_sets WHERE id = ?").run(existing.id);
      insertGearSet(db, set);
      mergeItems(db, harvestItemFacts({ gearSets: [set], lootAwards: [], wclPlayerFights: [] }));
      bumpDataVersion(db);
    });
    return existing ? { status: "replaced", set, previous: existing } : { status: "created", set };
  },

  async deleteGearSet(setId: string): Promise<boolean> {
    const db = getDb();
    let deleted = false;
    withTx(db, () => {
      const result = db.prepare("DELETE FROM gear_sets WHERE id = ?").run(setId);
      deleted = result.changes > 0;
      if (deleted) bumpDataVersion(db);
    });
    return deleted;
  },

  async setCurrentGearOverride(
    characterId: string,
    item: SlotItem,
    source: GearOverrideSource,
    spec: GearSpec = "main",
  ): Promise<SetCurrentGearOverrideResult> {
    if (!readModel().store.roster.some((c) => c.id === characterId)) {
      return { ok: false, error: "Character not found." };
    }
    const parsed = currentGearOverrideSchema.safeParse({
      characterId,
      item,
      source,
      spec,
      setAt: new Date().toISOString(),
    } satisfies CurrentGearOverride);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid gear override." };
    }
    const db = getDb();
    withTx(db, () => {
      insertCurrentGearOverride(db, parsed.data);
      // The pinned item is now referenced by the profile — teach the cache
      // whatever name came with it, like any other import does.
      mergeItems(db, [{ id: item.itemId, name: item.itemName, slot: item.slot }]);
      bumpDataVersion(db);
    });
    return { ok: true, override: parsed.data };
  },

  async setCurrentGearOverrides(
    characterId: string,
    items: SlotItem[],
    source: GearOverrideSource,
    opts: { replace?: boolean; spec?: GearSpec } = {},
  ): Promise<SetCurrentGearOverridesResult> {
    if (!readModel().store.roster.some((c) => c.id === characterId)) {
      return { ok: false, error: "Character not found." };
    }
    const spec = opts.spec ?? "main";
    const alreadyPinned = new Set(
      readModel()
        .store.currentGearOverrides.filter((o) => o.characterId === characterId && o.spec === spec)
        .map((o) => o.item.slot),
    );
    const setAt = new Date().toISOString();
    const parsed: CurrentGearOverride[] = [];
    let kept = 0;
    for (const item of items) {
      // A slot an officer set by hand outranks a bulk pass — it's the more
      // deliberate statement of the two.
      if (!opts.replace && alreadyPinned.has(item.slot)) {
        kept++;
        continue;
      }
      const result = currentGearOverrideSchema.safeParse({
        characterId,
        item,
        source,
        spec,
        setAt,
      } satisfies CurrentGearOverride);
      if (!result.success) {
        return { ok: false, error: result.error.issues[0]?.message ?? "Invalid gear override." };
      }
      parsed.push(result.data);
    }
    if (parsed.length === 0) return { ok: true, written: 0, kept };

    const db = getDb();
    withTx(db, () => {
      for (const override of parsed) insertCurrentGearOverride(db, override);
      mergeItems(
        db,
        parsed.map((o) => ({ id: o.item.itemId, name: o.item.itemName, slot: o.item.slot })),
      );
      bumpDataVersion(db);
    });
    return { ok: true, written: parsed.length, kept };
  },

  async clearCurrentGearOverride(
    characterId: string,
    slot: SlotId,
    spec: GearSpec = "main",
  ): Promise<boolean> {
    const db = getDb();
    let cleared = false;
    withTx(db, () => {
      cleared = Number(
        db.prepare("DELETE FROM current_gear_overrides WHERE character_id = ? AND spec = ? AND slot = ?")
          .run(characterId, spec, slot).changes,
      ) > 0;
      if (cleared) bumpDataVersion(db);
    });
    return cleared;
  },

  async clearCurrentGearOverrides(characterId: string, spec: GearSpec = "main"): Promise<number> {
    const db = getDb();
    let cleared = 0;
    withTx(db, () => {
      cleared = Number(
        db.prepare("DELETE FROM current_gear_overrides WHERE character_id = ? AND spec = ?")
          .run(characterId, spec).changes,
      );
      if (cleared > 0) bumpDataVersion(db);
    });
    return cleared;
  },
} satisfies Partial<Writes> & ThisType<WriteRepo>;
