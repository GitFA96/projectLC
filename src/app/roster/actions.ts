"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getWriteRepo } from "@/lib/data/repo";
import { CHARACTER_STATUSES, WOW_CLASSES, type Role, type WowClass } from "@/lib/constants/wow";

export type RosterActionResult = { ok: boolean; message: string };

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

const setStatusSchema = z.object({
  characterIds: z.array(z.string().min(1)).min(1),
  status: z.enum(CHARACTER_STATUSES),
});
export type SetStatusInput = z.infer<typeof setStatusSchema>;

/** Move characters between the guild roster and the known-puggers list. */
export async function setCharactersStatus(input: SetStatusInput): Promise<RosterActionResult> {
  const parsed = setStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid status change." };
  try {
    const repo = await getWriteRepo();
    const byId = new Map((await repo.listCharacters()).map((s) => [s.character.id, s.character]));
    const failures: string[] = [];
    let moved = 0;
    for (const id of parsed.data.characterIds) {
      const c = byId.get(id);
      if (!c) {
        failures.push("(missing character)");
        continue;
      }
      const result = await repo.updateCharacter(c.id, {
        name: c.name,
        class: c.class,
        spec: c.spec,
        role: c.role,
        race: c.race,
        status: parsed.data.status,
        note: c.note,
      });
      if (result.ok) moved++;
      else failures.push(`${c.name}: ${result.error}`);
    }
    revalidatePath("/", "layout");
    const target = parsed.data.status === "pug" ? "known puggers" : `the guild roster (${parsed.data.status})`;
    return {
      ok: failures.length === 0,
      message:
        `Moved ${plural(moved, "character")} to ${target}.` +
        (failures.length > 0 ? ` Failed: ${failures.join(" · ")}` : ""),
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Status change failed." };
  }
}

const deleteSchema = z.object({ characterIds: z.array(z.string().min(1)).min(1) });
export type DeleteCharactersInput = z.infer<typeof deleteSchema>;

/** Delete characters outright — their loot/log history is unlinked, not destroyed. */
export async function deleteCharacters(input: DeleteCharactersInput): Promise<RosterActionResult> {
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid delete request." };
  try {
    const repo = await getWriteRepo();
    const failures: string[] = [];
    let deleted = 0;
    let unlinkedAwards = 0;
    let unlinkedLogRows = 0;
    for (const id of parsed.data.characterIds) {
      const result = await repo.deleteCharacter(id);
      if (result.ok) {
        deleted++;
        unlinkedAwards += result.unlinkedAwards;
        unlinkedLogRows += result.unlinkedLogRows;
      } else {
        failures.push(result.error);
      }
    }
    revalidatePath("/", "layout");
    const unlinked = [
      unlinkedAwards > 0 ? `${plural(unlinkedAwards, "award")} reopened as unresolved` : undefined,
      unlinkedLogRows > 0 ? `${plural(unlinkedLogRows, "log pull")} back to untracked` : undefined,
    ].filter(Boolean);
    return {
      ok: failures.length === 0,
      message:
        `Deleted ${plural(deleted, "character")}.` +
        (unlinked.length > 0 ? ` ${unlinked.join(", ")}.` : "") +
        (failures.length > 0 ? ` Failed: ${failures.join(" · ")}` : ""),
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Delete failed." };
  }
}

const trackPlayersSchema = z.object({
  players: z
    .array(
      z.object({
        name: z.string().min(1),
        className: z.string().optional(),
        spec: z.string().optional(),
        wclRole: z.enum(["tank", "healer", "dps"]).optional(),
      }),
    )
    .min(1),
  status: z.enum(["pug", "main"]),
});
export type TrackPlayersInput = z.infer<typeof trackPlayersSchema>;

const MELEE_SPECS = new Set(
  ["arms", "fury", "combat", "assassination", "subtlety", "enhancement", "feral", "retribution"],
);

/** Best-effort Role from what the log knows; always editable afterwards. */
function guessRole(wclRole: "tank" | "healer" | "dps" | undefined, wowClass: WowClass, spec?: string): Role {
  if (wclRole === "tank") return "Tank";
  if (wclRole === "healer") return "Healer";
  if (spec && MELEE_SPECS.has(spec.toLowerCase())) return "Melee DPS";
  return ["Warrior", "Rogue", "Paladin"].includes(wowClass) ? "Melee DPS" : "Ranged DPS";
}

/**
 * Create characters for names seen in logs (as known puggers, or straight
 * onto the roster). Their already-imported log history attaches immediately —
 * log rows are re-matched by name at read time.
 */
export async function trackLogPlayers(input: TrackPlayersInput): Promise<RosterActionResult> {
  const parsed = trackPlayersSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid players." };
  const { players, status } = parsed.data;

  try {
    const repo = await getWriteRepo();
    const skipped: string[] = [];
    const failures: string[] = [];
    let created = 0;
    for (const player of players) {
      const wowClass = WOW_CLASSES.find((c) => c.toLowerCase() === player.className?.toLowerCase());
      if (!wowClass) {
        skipped.push(player.name);
        continue;
      }
      const result = await repo.createCharacter({
        name: player.name,
        class: wowClass,
        spec: player.spec ?? "Unknown",
        role: guessRole(player.wclRole, wowClass, player.spec),
        status,
        note: status === "pug" ? "Added from a Warcraft Logs import" : undefined,
      });
      if (result.ok) created++;
      else failures.push(`${player.name}: ${result.error}`);
    }
    revalidatePath("/", "layout");
    return {
      ok: failures.length === 0 && skipped.length === 0,
      message:
        (status === "pug"
          ? `Tracking ${plural(created, "player")} as known puggers — log history attached.`
          : `Added ${plural(created, "player")} to the guild roster.`) +
        (skipped.length > 0
          ? ` Skipped (class unknown — use “Add character”): ${skipped.join(", ")}.`
          : "") +
        (failures.length > 0 ? ` Failed: ${failures.join(" · ")}` : ""),
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not add the players." };
  }
}

/** Remove the seeded demo content, keeping everything imported since. */
export async function purgeDemoData(): Promise<RosterActionResult> {
  try {
    const repo = await getWriteRepo();
    const removed = await repo.purgeDemoData();
    revalidatePath("/", "layout");
    return {
      ok: true,
      message: `Demo data removed: ${removed.characters} characters, ${removed.raidSessions} raid sessions, ${removed.lootAwards} awards, ${removed.gearSets} gear sets, ${removed.wclReports} log report(s). Your imported data is untouched.`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Purge failed." };
  }
}
