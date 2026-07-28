import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { awardItemAction, clearAwardAction } from "@/app/characters/[name]/award-actions";
import { getSqliteRepo } from "@/lib/data/sqlite-repo";

/**
 * Awarding loot by hand, through the real server action.
 *
 * Vitest runs these outside a Next request, so revalidatePath() throws here —
 * which is exactly the condition that used to report a committed award as a
 * failure and invite a duplicating retry. Every "ok: true" below is also a
 * check that refreshing can't flip a successful write into an error.
 */
beforeEach(() => {
  process.env.PROJECTLC_DB = path.join(mkdtempSync(path.join(tmpdir(), "projectlc-")), "test.db");
});

/** Dragonspine Trophy — in the seeded item cache, so no Wowhead lookup. */
const SEEDED_ITEM = 28830;

describe("awardItemAction", () => {
  it("files an award under a new manual raid night and reports it as saved", async () => {
    const repo = getSqliteRepo();
    const thrainn = (await repo.findCharacterByName("Thrainn"))!;

    const result = await awardItemAction({
      characterId: thrainn.id,
      itemId: SEEDED_ITEM,
      offspec: false,
      note: "traded after the raid",
      target: { kind: "new", date: "2026-07-28", zone: "Serpentshrine Cavern" },
    });
    expect(result).toEqual({ ok: true, message: "Awarded “Dragonspine Trophy” to Thrainn." });

    const bundle = (await repo.getCharacterBundle("thrainn"))!;
    const awarded = bundle.awards.find((a) => a.award.itemId === SEEDED_ITEM)!;
    expect(awarded.award.characterId).toBe(thrainn.id);
    expect(awarded.award.note).toBe("traded after the raid");
    // A manual entry is its own dated session, marked as hand-entered.
    expect(awarded.session).toMatchObject({
      date: "2026-07-28",
      zones: ["Serpentshrine Cavern"],
      source: "manual",
    });
  });

  it("files into an existing raid night when one is picked", async () => {
    const repo = getSqliteRepo();
    const thrainn = (await repo.findCharacterByName("Thrainn"))!;
    const session = (await repo.listRaidSessions())[0];

    const result = await awardItemAction({
      characterId: thrainn.id,
      itemId: SEEDED_ITEM,
      offspec: true,
      target: { kind: "session", sessionId: session.id },
    });
    expect(result.ok).toBe(true);

    const bundle = (await repo.getCharacterBundle("thrainn"))!;
    const awarded = bundle.awards.find((a) => a.award.itemId === SEEDED_ITEM)!;
    expect(awarded.award.raidSessionId).toBe(session.id);
    expect(awarded.award.offspec).toBe(true);
  });

  it("refuses the same item twice on the same manual night instead of duplicating it", async () => {
    const repo = getSqliteRepo();
    const thrainn = (await repo.findCharacterByName("Thrainn"))!;
    const input = {
      characterId: thrainn.id,
      itemId: SEEDED_ITEM,
      offspec: false,
      target: { kind: "new", date: "2026-07-28", zone: "Serpentshrine Cavern" },
    } as const;

    expect((await awardItemAction(input)).ok).toBe(true);
    const second = await awardItemAction(input);
    expect(second.ok).toBe(false);
    expect(second.message).toContain("already recorded");
    const bundle = (await repo.getCharacterBundle("thrainn"))!;
    expect(bundle.awards.filter((a) => a.award.itemId === SEEDED_ITEM)).toHaveLength(1);
  });

  it("rejects an unknown character and a nonsense item id without writing", async () => {
    const repo = getSqliteRepo();
    const before = (await repo.listLootAwards()).length;
    const target = { kind: "new", date: "2026-07-28", zone: "Serpentshrine Cavern" } as const;

    expect(await awardItemAction({ characterId: "nope", itemId: SEEDED_ITEM, offspec: false, target })).toEqual({
      ok: false,
      message: "That character no longer exists.",
    });
    const thrainn = (await repo.findCharacterByName("Thrainn"))!;
    expect((await awardItemAction({ characterId: thrainn.id, itemId: 0, offspec: false, target })).ok).toBe(false);
    expect(await repo.listLootAwards()).toHaveLength(before);
  });
});

describe("clearAwardAction", () => {
  it("removes the award and reopens the wishlist slot", async () => {
    const repo = getSqliteRepo();
    const before = (await repo.getCharacterBundle("thrainn"))!;
    const openRow = before.wishlists[0].rows.find((r) => r.state === "open")!;

    await awardItemAction({
      characterId: before.character.id,
      itemId: openRow.wished.itemId,
      offspec: false,
      target: { kind: "new", date: "2026-07-28", zone: "Serpentshrine Cavern" },
    });
    const awarded = (await repo.getCharacterBundle("thrainn"))!;
    const awardedRow = awarded.wishlists[0].rows.find((r) => r.wished.itemId === openRow.wished.itemId)!;
    expect(awardedRow.state).toBe("awarded");

    const cleared = await clearAwardAction({ awardId: awardedRow.awardId! });
    expect(cleared.ok).toBe(true);
    const after = (await repo.getCharacterBundle("thrainn"))!;
    expect(after.wishlists[0].rows.find((r) => r.wished.itemId === openRow.wished.itemId)!.state).toBe("open");
    // Clearing something already gone is reported, not thrown.
    expect((await clearAwardAction({ awardId: awardedRow.awardId! })).ok).toBe(false);
  });
});
