import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createGuildRoster,
  deleteGuildRoster,
  renameGuildRoster,
  saveBoard,
  setRosterProspects,
} from "@/app/raid-planner/actions";
import { getSqliteRepo } from "@/lib/data/sqlite-repo";

/**
 * Saving a board, through the real server action.
 *
 * Two things are worth a test here and neither is the happy path. The board
 * **autosaves**, so this action runs while an officer is still dragging people
 * about — a failure it swallowed would lose a night's arrangement silently. And
 * it is the one place that decides *which* record a board lands in: send a
 * roster plan to a report's key and it overwrites the record of a raid that
 * actually happened.
 *
 * As with the award actions, vitest runs outside a Next request so
 * revalidatePath() throws — every `ok: true` below also proves a failed refresh
 * can't report a committed save as a failure.
 */
beforeEach(() => {
  process.env.PROJECTLC_DB = path.join(mkdtempSync(path.join(tmpdir(), "projectlc-")), "test.db");
});

const board = (...names: string[]) => [
  names.map((name) => ({ name })),
  [],
  [],
  [],
  [],
  [],
  [],
  [],
];

describe("saveBoard", () => {
  it("files a raid's board against that raid alone", async () => {
    const result = await saveBoard({
      target: { kind: "raid", code: "RPT1" },
      groups: board("Pyrelia", "Velora"),
    });
    expect(result.ok).toBe(true);

    const repo = getSqliteRepo();
    expect((await repo.getRaidBoard("RPT1")).groups[0]).toEqual([
      { name: "Pyrelia" },
      { name: "Velora" },
    ]);
    // Not into another night, and not into the guild's planner.
    expect((await repo.getRaidBoard("RPT2")).groups.flat()).toEqual([]);
    expect((await repo.getTemplateBoard()).groups.flat()).toEqual([]);
  });

  it("files the roster plan against the guild, leaving every raid alone", async () => {
    await saveBoard({ target: { kind: "raid", code: "RPT1" }, groups: board("Pyrelia") });
    await saveBoard({ target: { kind: "template" }, groups: board("Velora") });

    const repo = getSqliteRepo();
    expect((await repo.getTemplateBoard()).groups[0]).toEqual([{ name: "Velora" }]);
    expect((await repo.getRaidBoard("RPT1")).groups[0]).toEqual([{ name: "Pyrelia" }]);
  });

  it("keeps a spec override, which is half of what the board records", async () => {
    await saveBoard({
      target: { kind: "template" },
      groups: [[{ name: "Velora", spec: "Holy" }], [], [], [], [], [], [], []],
    });
    expect((await getSqliteRepo().getTemplateBoard()).groups[0]).toEqual([
      { name: "Velora", spec: "Holy" },
    ]);
  });

  it("clears the record when the board is emptied", async () => {
    await saveBoard({ target: { kind: "template" }, groups: board("Velora") });
    const cleared = await saveBoard({
      target: { kind: "template" },
      groups: [[], [], [], [], [], [], [], []],
    });
    expect(cleared.ok).toBe(true);
    expect((await getSqliteRepo().getTemplateBoard()).groups.flat()).toEqual([]);
  });

  it("re-sanitizes rather than trusting the board that sent it", async () => {
    await saveBoard({
      target: { kind: "template" },
      // The same raider twice would have them buffing two groups at once.
      groups: [[{ name: "Velora" }], [{ name: "velora" }, { name: "Pyrelia" }], [], [], [], [], [], []],
    });
    const saved = await getSqliteRepo().getTemplateBoard();
    expect(saved.groups[0]).toEqual([{ name: "Velora" }]);
    expect(saved.groups[1]).toEqual([{ name: "Pyrelia" }]);
  });

  it("reports a malformed board instead of writing half of it", async () => {
    const result = await saveBoard({
      target: { kind: "raid", code: "" },
      groups: board("Velora"),
    });
    expect(result.ok).toBe(false);
    expect((await getSqliteRepo().getTemplateBoard()).groups.flat()).toEqual([]);
  });
});

/**
 * The guild's own rosters.
 *
 * The thing worth testing here is that one meta row holds three things edited by
 * three different controls — the name an officer types, the trials they add, and
 * a board that autosaves under both. Any of the three writing the whole
 * row would silently drop the other two, and the officer would find out when a
 * roster they renamed lost its groups.
 */
describe("guild rosters", () => {
  it("creates a roster with a name of its own and nothing on it", async () => {
    const created = await createGuildRoster();
    expect(created.ok).toBe(true);

    const boards = await getSqliteRepo().listGuildRosters();
    expect(boards).toHaveLength(1);
    expect(boards[0]).toMatchObject({ id: created.id, name: "Roster 1", prospects: [] });
    expect(boards[0].board.groups.flat()).toEqual([]);
  });

  it("numbers new rosters past the ones already there", async () => {
    await createGuildRoster();
    await createGuildRoster();
    const names = (await getSqliteRepo().listGuildRosters()).map((b) => b.name);
    expect(names).toEqual(["Roster 1", "Roster 2"]);
  });

  it("keeps each roster's board to itself", async () => {
    const a = await createGuildRoster("Core");
    const b = await createGuildRoster("Split");
    await saveBoard({ target: { kind: "roster", id: a.id! }, groups: board("Pyrelia") });
    await saveBoard({ target: { kind: "roster", id: b.id! }, groups: board("Velora") });

    const repo = getSqliteRepo();
    expect((await repo.getGuildRoster(a.id!))?.board.groups[0]).toEqual([{ name: "Pyrelia" }]);
    expect((await repo.getGuildRoster(b.id!))?.board.groups[0]).toEqual([{ name: "Velora" }]);
    // And not into the template or a raid night, which share nothing with these.
    expect((await repo.getTemplateBoard()).groups.flat()).toEqual([]);
  });

  it("keeps the name and the trials when the board autosaves over them", async () => {
    const { id } = await createGuildRoster("Core");
    await setRosterProspects(id!, [{ name: "Trialsham", wowClass: "Shaman", role: "healer" }]);
    await saveBoard({ target: { kind: "roster", id: id! }, groups: board("Trialsham") });

    const saved = await getSqliteRepo().getGuildRoster(id!);
    expect(saved?.name).toBe("Core");
    expect(saved?.prospects).toEqual([{ name: "Trialsham", wowClass: "Shaman", role: "healer" }]);
    expect(saved?.board.groups[0]).toEqual([{ name: "Trialsham" }]);
  });

  it("keeps the groups when the roster is renamed", async () => {
    const { id } = await createGuildRoster("Core");
    await saveBoard({ target: { kind: "roster", id: id! }, groups: board("Pyrelia") });
    await renameGuildRoster(id!, "Split A");

    const saved = await getSqliteRepo().getGuildRoster(id!);
    expect(saved?.name).toBe("Split A");
    expect(saved?.board.groups[0]).toEqual([{ name: "Pyrelia" }]);
  });

  it("keeps a roster that has been cleared, unlike a raid night's board", async () => {
    // A raid night's empty board means "never laid out" and is worth nothing to
    // store. A roster exists because somebody made and named it.
    const { id } = await createGuildRoster("Core");
    await saveBoard({ target: { kind: "roster", id: id! }, groups: board("Pyrelia") });
    await saveBoard({
      target: { kind: "roster", id: id! },
      groups: [[], [], [], [], [], [], [], []],
    });

    const saved = await getSqliteRepo().getGuildRoster(id!);
    expect(saved?.name).toBe("Core");
    expect(saved?.board.groups.flat()).toEqual([]);
  });

  it("does not recreate a roster that was deleted while a save was in flight", async () => {
    const { id } = await createGuildRoster("Core");
    await deleteGuildRoster(id!);
    const late = await saveBoard({
      target: { kind: "roster", id: id! },
      groups: board("Pyrelia"),
    });

    expect(late.ok).toBe(true);
    expect(await getSqliteRepo().listGuildRosters()).toEqual([]);
  });

  it("refuses a blank name rather than leaving an unclickable pill", async () => {
    const { id } = await createGuildRoster("Core");
    expect((await renameGuildRoster(id!, "   ")).ok).toBe(false);
    expect((await getSqliteRepo().getGuildRoster(id!))?.name).toBe("Core");
  });

  it("drops a junk trial rather than writing it", async () => {
    const { id } = await createGuildRoster("Core");
    const res = await setRosterProspects(id!, [{ name: "" }]);
    expect(res.ok).toBe(false);
    expect((await getSqliteRepo().getGuildRoster(id!))?.prospects).toEqual([]);
  });
});
