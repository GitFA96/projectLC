import { randomUUID } from "node:crypto";
import {
  bumpDataVersion,
  getDb,
  insertGuildAuditEntry,
  insertLootAward,
  insertRaidSession,
  mergeItems,
  withTx,
} from "@/lib/data/db";
import { harvestItemFacts, isPlaceholderName } from "@/lib/items/item-data";
import { lootAwardSchema } from "@/lib/import/schemas";
import type {
  AwardAuditActor,
  AwardDraft,
  AwardEditInput,
  AwardResolution,
  AwardWriteResult,
  DeleteSessionResult,
  GargulCommitResult,
  RaidSessionDraft,
  ResolveAwardResult,
  WriteRepo,
} from "@/lib/data/repo";
import type { AwardDecision, LootAward, RaidSession } from "@/lib/types";
import { readModel, characterByName } from "./model";
import type { Writes } from "./model";

/**
 * Raid nights, the awards made on them, and the record of who changed what.
 *
 * Two things here exist for the guild rather than for the code.
 * `captureDecision` freezes the board as it read at the moment of the award, so
 * a ruling can be defended months later against the numbers it was actually
 * made on — and returns undefined rather than a zero when the item was never
 * contested, because "the ranking did not decide this" is a different fact
 * from a low score. `auditAward` writes the amendment into the same ledger the
 * guild reads its governance from, under `loot.*` kinds so the audit page can
 * keep an award being re-dated apart from somebody being given a role.
 */

/** Shared shape check for a manual/edited award before it touches the database. */
function checkAwardInput(input: AwardEditInput): { ok: true } | { ok: false; error: string } {
  if (!Number.isInteger(input.itemId) || input.itemId <= 0) {
    return { ok: false, error: "Enter a valid item id." };
  }
  if (!input.itemName.trim()) return { ok: false, error: "An item name is required." };
  if (!input.rawWinnerName.trim()) return { ok: false, error: "A winner is required." };
  if (input.characterId !== null) {
    if (input.external) return { ok: false, error: "An award linked to a character can't also be off-roster." };
    if (!readModel().store.roster.some((c) => c.id === input.characterId)) {
      return { ok: false, error: "That character no longer exists." };
    }
  }
  return { ok: true };
}

/** The day part of a stored award timestamp — what an officer means by "the date". */
function awardDay(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * What the guild is told about an amendment, in the words a member would use.
 *
 * Only what moved. The log is read months later by somebody reconstructing a
 * decision — "Thrainn, off-spec → main spec" answers that; a dump of every
 * field, most of them unchanged, does not.
 */
function describeAwardEdit(before: LootAward, after: LootAward): string[] {
  const changes: string[] = [];
  if (before.itemId !== after.itemId) {
    changes.push(`item ${before.itemName} → ${after.itemName}`);
  }
  if (awardDay(before.awardedAt) !== awardDay(after.awardedAt)) {
    changes.push(`won ${awardDay(before.awardedAt)} → ${awardDay(after.awardedAt)}`);
  }
  if (before.rawWinnerName !== after.rawWinnerName || before.characterId !== after.characterId) {
    changes.push(`winner ${before.rawWinnerName} → ${after.rawWinnerName}`);
  }
  if (before.offspec !== after.offspec) {
    changes.push(after.offspec ? "main spec → off-spec" : "off-spec → main spec");
  }
  if ((before.note ?? "") !== (after.note ?? "")) changes.push("note changed");
  return changes;
}

/**
 * Write what an officer did to the ledger, in the transaction that did it.
 *
 * Same table the guild reads its governance from, under `loot.*` kinds so the
 * audit page can keep the two streams apart — an award being re-dated is not
 * the same kind of fact as somebody being given a role, and merging them would
 * blur a line that page draws on purpose.
 *
 * Silent without an actor: the repo is also driven by tests and imports, and a
 * line reading "an officer" for a Gargul paste would be a lie in the record.
 */
function auditAward(
  db: ReturnType<typeof getDb>,
  audit: AwardAuditActor | undefined,
  kind: string,
  detail: string,
): void {
  if (!audit) return;
  insertGuildAuditEntry(db, {
    id: `aud_${randomUUID().slice(0, 12)}`,
    guildId: audit.guildId,
    kind,
    actor: audit.actor,
    detail: detail.slice(0, 1000),
    at: new Date().toISOString(),
  });
}

/**
 * The board as it reads right now, for the winner about to be given the item.
 *
 * Returns undefined when there is nothing to freeze — the item was never
 * contested, or the winner wasn't on the board. Absent is honest: it says the
 * award didn't come from the ranking, which is a different fact from a low
 * score, and the ledger must never present it as one.
 */
async function captureDecision(
  itemId: number,
  characterId: string,
): Promise<AwardDecision | undefined> {
  const contention = await readModel().repo.getItemContention(itemId);
  const wisher = contention?.wishers.find((w) => w.character.id === characterId);
  if (!contention || !wisher) return undefined;

  const policy = await readModel().repo.getGuildPolicy();
  return {
    score: wisher.priority?.score,
    rank: wisher.rank,
    contenders: contention.wishers.filter((w) => !w.satisfied).length,
    factors: (wisher.priority?.factors ?? []).map((f) => ({
      label: f.label,
      score: f.score,
      weight: f.weight,
      detail: f.detail,
    })),
    adjustments: (wisher.priority?.adjustments ?? []).map((a) => ({
      label: a.label,
      multiplier: a.multiplier,
      note: a.note,
    })),
    chain: contention.priorityRule?.chain,
    tierLabel: wisher.priorityTierLabel,
    weights: policy.weights,
    capturedAt: new Date().toISOString(),
  };
}

export const lootWrites = {
  async createRaidSessionWithAwards(
    sessionDraft: RaidSessionDraft,
    awardDrafts: AwardDraft[],
  ): Promise<GargulCommitResult> {
    const db = getDb();
    const model = readModel();
    const session: RaidSession = {
      ...sessionDraft,
      id: `rs_${randomUUID()}`,
      guildId: model.store.guild.id,
    };

    const isDuplicate = db.prepare(
      "SELECT 1 FROM loot_awards WHERE item_id = ? AND raw_winner_name = ? COLLATE NOCASE AND awarded_at = ? LIMIT 1",
    );
    const seenInBatch = new Set<string>();
    const toInsert: LootAward[] = [];
    const unresolved = new Set<string>();
    let skippedDuplicates = 0;

    for (const draft of awardDrafts) {
      const key = `${draft.itemId}|${draft.rawWinnerName.toLowerCase()}|${draft.awardedAt}`;
      if (seenInBatch.has(key) || isDuplicate.get(draft.itemId, draft.rawWinnerName, draft.awardedAt)) {
        skippedDuplicates++;
        continue;
      }
      seenInBatch.add(key);
      const character = characterByName(draft.rawWinnerName);
      if (!character) unresolved.add(draft.rawWinnerName);
      toInsert.push({
        id: `la_${randomUUID()}`,
        raidSessionId: session.id,
        characterId: character?.id ?? null,
        external: false,
        rawWinnerName: draft.rawWinnerName,
        itemId: draft.itemId,
        itemName: draft.itemName,
        awardedAt: draft.awardedAt,
        offspec: draft.offspec,
        note: draft.note,
      });
    }

    if (toInsert.length === 0) {
      return { session: undefined, inserted: 0, skippedDuplicates, unresolved: [] };
    }

    withTx(db, () => {
      insertRaidSession(db, session);
      for (const award of toInsert) insertLootAward(db, award);
      // A paste that named its items teaches the cache those names; invented
      // "Item #30048" ones are filtered out by the harvest.
      mergeItems(db, harvestItemFacts({ gearSets: [], lootAwards: toInsert, wclPlayerFights: [] }));
      bumpDataVersion(db);
    });
    return {
      session,
      inserted: toInsert.length,
      skippedDuplicates,
      unresolved: [...unresolved].sort(),
    };
  },

  async resolveAward(awardId: string, resolution: AwardResolution): Promise<ResolveAwardResult> {
    const award = readModel().store.lootAwards.find((a) => a.id === awardId);
    if (!award) return { ok: false, error: "Award not found — it may have been removed." };

    let characterId: string | null = null;
    let external = false;
    if (resolution.kind === "character") {
      const character = readModel().store.roster.find((c) => c.id === resolution.characterId);
      if (!character) return { ok: false, error: "That character no longer exists." };
      characterId = character.id;
    } else if (resolution.kind === "external") {
      external = true;
    }

    const db = getDb();
    withTx(db, () => {
      db.prepare("UPDATE loot_awards SET character_id = ?, external = ? WHERE id = ?").run(
        characterId, external ? 1 : 0, awardId,
      );
      bumpDataVersion(db);
    });
    return { ok: true, award: { ...award, characterId, external } };
  },

  async addLootAward(raidSessionId: string, input: AwardEditInput): Promise<AwardWriteResult> {
    const session = readModel().store.raidSessions.find((s) => s.id === raidSessionId);
    if (!session) return { ok: false, error: "That raid session no longer exists." };
    const check = checkAwardInput(input);
    if (!check.ok) return check;

    // Freeze the board as it read at this moment. Computed HERE rather than
    // taken from the caller: a client-supplied score could be stale or simply
    // wrong, and the whole value of the snapshot is that it's the arithmetic
    // the app actually produced.
    const decision = input.characterId
      ? await captureDecision(input.itemId, input.characterId)
      : undefined;

    const parsed = lootAwardSchema.safeParse({
      id: `la_${randomUUID()}`,
      raidSessionId,
      characterId: input.characterId,
      external: input.external,
      rawWinnerName: input.rawWinnerName.trim(),
      itemId: input.itemId,
      itemName: input.itemName.trim(),
      // Manual awards have no Gargul timestamp — file them at noon on the raid date.
      awardedAt: `${session.date}T12:00:00`,
      offspec: input.offspec,
      note: input.note?.trim() || undefined,
      decision,
    } satisfies LootAward);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid award." };

    const db = getDb();
    withTx(db, () => {
      insertLootAward(db, parsed.data);
      bumpDataVersion(db);
    });
    return { ok: true, award: parsed.data };
  },

  async updateLootAward(
    awardId: string,
    input: AwardEditInput,
    audit?: AwardAuditActor,
  ): Promise<AwardWriteResult> {
    const existing = readModel().store.lootAwards.find((a) => a.id === awardId);
    if (!existing) return { ok: false, error: "Award not found — it may have been removed." };
    const check = checkAwardInput(input);
    if (!check.ok) return check;

    const parsed = lootAwardSchema.safeParse({
      ...existing,
      characterId: input.characterId,
      external: input.external,
      rawWinnerName: input.rawWinnerName.trim(),
      itemId: input.itemId,
      itemName: input.itemName.trim(),
      offspec: input.offspec,
      note: input.note?.trim() || undefined,
      // Absent leaves the stored timestamp alone — an edit that doesn't touch
      // the date must not quietly re-stamp it (a Gargul import's time of day is
      // real information, and noon-on-the-day would throw it away).
      awardedAt: input.awardedAt ?? existing.awardedAt,
    } satisfies LootAward);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid award." };
    const award = parsed.data;
    const changes = describeAwardEdit(existing, award);

    const db = getDb();
    withTx(db, () => {
      db.prepare(
        `UPDATE loot_awards
            SET character_id = ?, external = ?, raw_winner_name = ?, item_id = ?, item_name = ?, offspec = ?, note = ?, awarded_at = ?
          WHERE id = ?`,
      ).run(
        award.characterId, award.external ? 1 : 0, award.rawWinnerName, award.itemId,
        award.itemName, award.offspec ? 1 : 0, award.note ?? null, award.awardedAt, awardId,
      );
      // Nothing moved, nothing to tell the guild — an officer opening the
      // editor and saving unchanged is not an event.
      if (changes.length > 0) {
        auditAward(db, audit, "loot.amended", `${award.itemName} — ${changes.join("; ")}.`);
      }
      bumpDataVersion(db);
    });
    return { ok: true, award };
  },

  async deleteLootAward(awardId: string, audit?: AwardAuditActor): Promise<boolean> {
    const existing = readModel().store.lootAwards.find((a) => a.id === awardId);
    const db = getDb();
    let deleted = false;
    withTx(db, () => {
      deleted = Number(db.prepare("DELETE FROM loot_awards WHERE id = ?").run(awardId).changes) > 0;
      if (deleted) {
        // The row is gone; the record of it going is the only thing left that
        // can explain why a raider's history is one item shorter.
        if (existing) {
          auditAward(
            db,
            audit,
            "loot.removed",
            `${existing.itemName} — ${existing.rawWinnerName}, won ${awardDay(existing.awardedAt)} — removed from the ledger.`,
          );
        }
        bumpDataVersion(db);
      }
    });
    return deleted;
  },

  async deleteRaidSession(raidSessionId: string, audit?: AwardAuditActor): Promise<DeleteSessionResult> {
    const session = readModel().store.raidSessions.find((s) => s.id === raidSessionId);
    if (!session) {
      return { ok: false, error: "Raid session not found — maybe already removed." };
    }
    const db = getDb();
    let deletedAwards = 0;
    let unlinkedReports = 0;
    withTx(db, () => {
      deletedAwards = Number(
        db.prepare("DELETE FROM loot_awards WHERE raid_session_id = ?").run(raidSessionId).changes,
      );
      // A linked Warcraft Logs report outlives the session — just cut the link.
      unlinkedReports = Number(
        db.prepare("UPDATE wcl_reports SET raid_session_id = NULL WHERE raid_session_id = ?").run(raidSessionId).changes,
      );
      db.prepare("DELETE FROM raid_sessions WHERE id = ?").run(raidSessionId);
      // Deleting the import is the other way awards leave the ledger, and it
      // takes several at once. Recording only the single-award path would
      // leave the bigger act as the unwatched one.
      if (deletedAwards > 0) {
        auditAward(
          db,
          audit,
          "loot.removed",
          `${session.date} ${session.zones.join(" + ")} — import deleted, ${deletedAwards} award${deletedAwards === 1 ? "" : "s"} removed.`,
        );
      }
      bumpDataVersion(db);
    });
    return { ok: true, deletedAwards, unlinkedReports };
  },

  async repairPlaceholderAwardNames(): Promise<number> {
    const db = getDb();
    const byId = new Map(readModel().store.items.map((i) => [i.id, i]));
    const stale = readModel().store.lootAwards.filter(
      (a) => isPlaceholderName(a.itemName) && byId.get(a.itemId)?.name !== undefined,
    );
    if (stale.length === 0) return 0;
    withTx(db, () => {
      const stmt = db.prepare("UPDATE loot_awards SET item_name = ? WHERE id = ?");
      for (const award of stale) stmt.run(byId.get(award.itemId)!.name as string, award.id);
      bumpDataVersion(db);
    });
    return stale.length;
  },
} satisfies Partial<Writes> & ThisType<WriteRepo>;
