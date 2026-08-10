"use server";

import { getWriteRepo } from "@/lib/data/repo";
import { refreshAfterWrite } from "@/lib/refresh";

/**
 * Writing a class or spec guide.
 *
 * The guide is the guild's summary plus the pages it came from — never a copy
 * of somebody else's. That's the same rule the rest of the app follows about
 * naming a source rather than asserting from memory, and it's why `sources`
 * sits beside the body rather than being optional decoration.
 */
export interface GuideActionResult {
  ok: boolean;
  message: string;
}

export async function saveClassGuideAction(input: {
  wowClass: string;
  /** Empty for the class-level guide. */
  spec: string;
  body: string;
  /** One per line, as typed. Non-URLs are kept and shown as plain text. */
  sources: string;
  author?: string;
}): Promise<GuideActionResult> {
  try {
    const repo = await getWriteRepo();
    const result = await repo.setClassGuide({
      wowClass: input.wowClass,
      spec: input.spec,
      body: input.body,
      sources: input.sources.split(/\r?\n/),
      author: input.author,
    });
    if (!result.ok) return { ok: false, message: result.error };
    refreshAfterWrite("/guides", "layout");
    const what = input.spec ? `${input.spec} ${input.wowClass}` : input.wowClass;
    return {
      ok: true,
      message: result.deleted ? `Cleared the ${what} guide.` : `Saved the ${what} guide.`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Saving the guide failed." };
  }
}
