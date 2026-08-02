"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getWriteRepo } from "@/lib/data/repo";
import { refreshAfterWrite } from "@/lib/refresh";
import { CHARACTER_STATUSES, ROLES, WOW_CLASSES } from "@/lib/constants/wow";

/**
 * Roster edits: create + update characters, delete imported gear sets.
 * No auth by design (v1 is an officers-only deployment) — every action still
 * validates input server side and reports conflicts instead of throwing.
 */

const characterFormSchema = z.object({
  /** Empty string = create; otherwise the character id to update. */
  id: z.string(),
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters.")
    .max(12, "WoW names are at most 12 characters.")
    .regex(/^[\p{L}]+$/u, "Names are letters only (no spaces or digits)."),
  class: z.enum(WOW_CLASSES, "Pick a class."),
  spec: z.string().trim().min(1, "Spec is required (e.g. Protection)."),
  role: z.enum(ROLES, "Pick a role."),
  /** A second spec they actually raid in; blank when they only play one. */
  offSpec: z.string().trim().optional(),
  offSpecRole: z.string().trim().optional(),
  race: z.string().trim().optional(),
  status: z.enum(CHARACTER_STATUSES),
  /** Selected main when status is "alt" (a character id); empty otherwise. */
  mainCharacterId: z.string().trim().optional(),
  note: z.string().trim().optional(),
});

export interface CharacterFormState {
  error?: string;
  /** Echoed back so the form can re-render what was submitted. */
  values?: Record<string, string>;
}

export async function saveCharacter(
  _prev: CharacterFormState,
  formData: FormData,
): Promise<CharacterFormState> {
  const raw = Object.fromEntries(
    [
      "id", "name", "class", "spec", "role", "offSpec", "offSpecRole", "race", "status",
      "mainCharacterId", "note",
    ].map((k) => [k, (formData.get(k) ?? "").toString()]),
  );
  const parsed = characterFormSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid character.", values: raw };
  }
  const { id, mainCharacterId, offSpec, offSpecRole, ...fields } = parsed.data;
  // An off-spec role without an off-spec means nothing, so they travel together.
  const secondSpec = offSpec || undefined;
  const secondRole = secondSpec
    ? (ROLES as readonly string[]).includes(offSpecRole ?? "")
      ? (offSpecRole as (typeof ROLES)[number])
      : undefined
    : undefined;
  if (secondSpec && secondSpec.toLowerCase() === fields.spec.toLowerCase()) {
    return { error: "The off-spec has to differ from the main spec.", values: raw };
  }
  // The main link only applies to alts; clear it for any other status. An alt
  // can't be its own main.
  const main = fields.status === "alt" ? (mainCharacterId || null) : null;
  if (main !== null && main === id) {
    return { error: "A character can't be its own main.", values: raw };
  }
  const draft = {
    ...fields,
    offSpec: secondSpec,
    offSpecRole: secondRole,
    race: fields.race || undefined,
    mainCharacterId: main,
    note: fields.note || undefined,
  };

  let savedName: string;
  try {
    const repo = await getWriteRepo();
    const result = id ? await repo.updateCharacter(id, draft) : await repo.createCharacter(draft);
    if (!result.ok) return { error: result.error, values: raw };
    savedName = result.character.name;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Saving failed.", values: raw };
  }

  refreshAfterWrite("/", "layout");
  redirect(`/characters/${encodeURIComponent(savedName.toLowerCase())}`);
}

export interface DeleteGearSetResult {
  ok: boolean;
  message: string;
}

export async function deleteGearSet(setId: string): Promise<DeleteGearSetResult> {
  try {
    const repo = await getWriteRepo();
    const deleted = await repo.deleteGearSet(setId);
    if (!deleted) return { ok: false, message: "That set no longer exists." };
    refreshAfterWrite("/", "layout");
    return { ok: true, message: "Set deleted." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Delete failed." };
  }
}
