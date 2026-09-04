import { describe, expect, it } from "vitest";
import { SLOT_META, type SlotId } from "@/lib/constants/wow";
import { diffGearSetSlots } from "@/lib/import/diff";
import type { SlotItem } from "@/lib/types";

/**
 * The confirm step of an import: "here is what changes if you press OK".
 *
 * An officer reads this list and nothing else before overwriting a raider's
 * set, so the two ways it can lie are both expensive. A row that should not be
 * there teaches them to skim the list; a row that is missing means they
 * approved a change they never saw. Both are asserted below, and the second
 * one has a real cause behind it — rings and trinkets come out of
 * SixtyUpgrades in whichever order the exporter felt like, so comparing them
 * by index reports a swap on almost every import.
 */

const gear = (slot: SlotId, itemId: number, itemName = `Item ${itemId}`): SlotItem => ({
  slot,
  itemId,
  itemName,
});

describe("what the confirm step lists", () => {
  it("says nothing at all when the set is identical", () => {
    const set = [gear("head", 29011), gear("ring1", 28793), gear("trinket1", 28830)];
    expect(diffGearSetSlots(set, set)).toEqual([]);
  });

  it("names the slot, the old item and the new one", () => {
    const rows = diffGearSetSlots(
      [gear("head", 29011, "Cursed Vision of Sargeras")],
      [gear("head", 31051, "Cowl of Benevolence")],
    );
    expect(rows).toEqual([
      { label: "Head", before: ["Cursed Vision of Sargeras"], after: ["Cowl of Benevolence"] },
    ]);
  });

  it("reports an empty slot being filled, and a filled one being emptied", () => {
    expect(diffGearSetSlots([], [gear("neck", 30017, "Choker of Vile Intent")])).toEqual([
      { label: "Neck", before: [], after: ["Choker of Vile Intent"] },
    ]);
    expect(diffGearSetSlots([gear("neck", 30017, "Choker of Vile Intent")], [])).toEqual([
      { label: "Neck", before: ["Choker of Vile Intent"], after: [] },
    ]);
  });

  it("lists changed slots in the order the character sheet shows them", () => {
    // Deliberately supplied bottom-up: the input order is whatever the parser
    // happened to emit, and the officer reads the sheet top-down.
    const before = [gear("ranged", 1), gear("hands", 2), gear("head", 3)];
    const after = [gear("ranged", 11), gear("hands", 12), gear("head", 13)];
    expect(diffGearSetSlots(before, after).map((r) => r.label)).toEqual(["Head", "Hands", "Ranged"]);
  });
});

describe("rings and trinkets, which come in interchangeable pairs", () => {
  it("is silent when the same two rings arrive on the other fingers", () => {
    // The whole reason `diff.ts` buckets by family. SixtyUpgrades does not
    // promise a stable finger, so an index-by-index comparison would report a
    // change here on import after import, for a set nobody touched.
    const before = [gear("ring1", 28793, "Band of Crimson Fury"), gear("ring2", 29305, "Band of Al'ar")];
    const after = [gear("ring1", 29305, "Band of Al'ar"), gear("ring2", 28793, "Band of Crimson Fury")];
    expect(diffGearSetSlots(before, after)).toEqual([]);
  });

  it("is silent when trinkets swap, for the same reason", () => {
    const before = [gear("trinket1", 28830), gear("trinket2", 29383)];
    const after = [gear("trinket1", 29383), gear("trinket2", 28830)];
    expect(diffGearSetSlots(before, after)).toEqual([]);
  });

  it("reports one row for the pair when one of the two actually changes", () => {
    const rows = diffGearSetSlots(
      [gear("ring1", 28793, "Band of Crimson Fury"), gear("ring2", 29305, "Band of Al'ar")],
      [gear("ring1", 29305, "Band of Al'ar"), gear("ring2", 30366, "Ring of Lethality")],
    );
    // One row headed "Rings", not two headed "Ring 1" and "Ring 2" — the
    // officer is being asked about a pair, because that is what changed.
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("Rings");
    expect(rows[0].before).toEqual(["Band of Crimson Fury", "Band of Al'ar"]);
    expect(rows[0].after).toEqual(["Band of Al'ar", "Ring of Lethality"]);
  });

  it("notices two of the same ring becoming one, which a set comparison could miss", () => {
    // Same id twice is not legal in game, but it is legal in a hand-edited
    // import, and a diff that compared *sets* rather than multisets would call
    // this identical and drop a slot silently.
    const before = [gear("ring1", 28793), gear("ring2", 28793)];
    const after = [gear("ring1", 28793)];
    expect(diffGearSetSlots(before, after)).toHaveLength(1);
  });

  it("keeps the pair where the first of its slots sits on the sheet", () => {
    const rows = diffGearSetSlots(
      [gear("ring1", 1), gear("mainHand", 2), gear("waist", 3)],
      [gear("ring1", 11), gear("mainHand", 12), gear("waist", 13)],
    );
    expect(rows.map((r) => r.label)).toEqual(["Waist", "Rings", "Main Hand"]);
  });
});

describe("every slot the app knows about", () => {
  // A new slot added to SLOT_META with no label, or one that falls out of the
  // ordering map, would show up here as a row headed `undefined` or as a row
  // sorted to the end. Neither is visible in a hand-written case for `head`.
  it.each(SLOT_META.map((s) => [s.id, s.label] as const))(
    "%s renders as %s",
    (slot, label) => {
      const rows = diffGearSetSlots([gear(slot, 100)], [gear(slot, 200)]);
      expect(rows).toHaveLength(1);
      // Rings and trinkets answer to their family name; everything else to its own.
      expect(rows[0].label).toBe(
        slot.startsWith("ring") ? "Rings" : slot.startsWith("trinket") ? "Trinkets" : label,
      );
    },
  );
});
