"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getWriteRepo } from "@/lib/data/repo";
import { CHARACTER_STATUSES, WOW_CLASSES, type Role, type WowClass } from "@/lib/constants/wow";

export type RosterActionResult = { ok: boolean; message: string };

const setStatusSchema = z.object({
  characterId: z.string().min(1),
  status: z.enum(CHARACTER_STATUSES),
});
export type SetStatusInput = z.infer<typeof setStatusSchema>;

/** Move a character between the guild roster and the known-puggers list. */
export async function setCharacterStatus(input: SetStatusInput): Promise<RosterActionResult> {
  const parsed = setStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid status change." };
  try {
    const repo = await getWriteRepo();
    const summary = (await repo.listCharacters()).find(
      (s) => s.character.id === parsed.data.characterId,
    );
    if (!summary) return { ok: false, message: "Character not found." };
    const c = summary.character;
    const result = await repo.updateCharacter(c.id, {
      name: c.name,
      class: c.class,
      spec: c.spec,
      role: c.role,
      race: c.race,
      status: parsed.data.status,
      note: c.note,
    });
    if (!result.ok) return { ok: false, message: result.error };
    revalidatePath("/", "layout");
    return {
      ok: true,
      message:
        parsed.data.status === "pug"
          ? `${c.name} moved to known puggers.`
          : `${c.name} moved to the guild roster (${parsed.data.status}).`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Status change failed." };
  }
}

const trackPlayerSchema = z.object({
  name: z.string().min(1),
  className: z.string().optional(),
  spec: z.string().optional(),
  wclRole: z.enum(["tank", "healer", "dps"]).optional(),
  status: z.enum(["pug", "main"]),
});
export type TrackPlayerInput = z.infer<typeof trackPlayerSchema>;

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
 * Create a character for a name seen in logs (as a known pugger, or straight
 * onto the roster). Their already-imported log history attaches immediately —
 * log rows are re-matched by name at read time.
 */
export async function trackLogPlayer(input: TrackPlayerInput): Promise<RosterActionResult> {
  const parsed = trackPlayerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid player." };
  const { name, className, spec, wclRole, status } = parsed.data;

  const wowClass = WOW_CLASSES.find((c) => c.toLowerCase() === className?.toLowerCase());
  if (!wowClass) {
    return {
      ok: false,
      message: `The log doesn't say which class ${name} is — add them via “Add character” instead.`,
    };
  }

  try {
    const repo = await getWriteRepo();
    const result = await repo.createCharacter({
      name,
      class: wowClass,
      spec: spec ?? "Unknown",
      role: guessRole(wclRole, wowClass, spec),
      status,
      note: status === "pug" ? "Added from a Warcraft Logs import" : undefined,
    });
    if (!result.ok) return { ok: false, message: result.error };
    revalidatePath("/", "layout");
    return {
      ok: true,
      message:
        status === "pug"
          ? `${name} is now a known pugger — their log history is attached.`
          : `${name} added to the guild roster.`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not add the player." };
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
