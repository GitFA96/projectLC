"use server";

import { getRepo, getWriteRepo } from "@/lib/data/repo";
import { refreshAfterWrite } from "@/lib/refresh";
import { can, isAppAdmin, requireCapability } from "@/lib/auth/can";
import { resolveViewer } from "@/lib/auth/viewer";
import { OPERATOR_OWNER, type GuideKind } from "@/lib/guides";

/**
 * Writing a guide, for either owner.
 *
 * The guide is a summary plus the pages it came from — never a copy of somebody
 * else's. That's the same rule the rest of the app follows about naming a source
 * rather than asserting from memory, and it's why `sources` sits beside the body
 * rather than being optional decoration.
 *
 * Two owners, two gates. The shared baseline is service data and takes
 * app-admin: an operator writing "how Supremus works" writes it for every guild
 * on the deployment, and a guild must not be able to edit what another guild
 * reads. A guild's own guide takes `guides.edit`, exactly as before.
 *
 * The owner is resolved HERE and never accepted from the client. A form that
 * could name its own owner would let anyone holding `guides.edit` write the
 * operator's baseline by changing one field.
 */
export interface GuideActionResult {
  ok: boolean;
  message: string;
}

export async function saveGuideAction(input: {
  kind: GuideKind;
  subject: string;
  /** Empty for the subject-level guide. */
  section: string;
  body: string;
  /** One per line, as typed. Non-URLs are kept and shown as plain text. */
  sources: string;
  author?: string;
  /** True to write the shared baseline instead of this guild's own. */
  asOperator?: boolean;
}): Promise<GuideActionResult> {
  try {
    const viewer = await resolveViewer();
    let owner: string;
    if (input.asOperator) {
      if (!isAppAdmin(viewer)) {
        return { ok: false, message: "Only whoever runs the service can write the shared guide." };
      }
      owner = OPERATOR_OWNER;
    } else {
      // Written inline rather than reusing `viewer` above: the enforcement test
      // scans for exactly this shape, and a capability it cannot see is one it
      // cannot prove is checked. See docs/change-chains.md §11.
      requireCapability(await resolveViewer(), "guides.edit");
      owner = (await (await getRepo()).getGuild()).id;
    }

    const repo = await getWriteRepo();
    const result = await repo.setGuide({
      kind: input.kind,
      subject: input.subject,
      section: input.section,
      owner,
      body: input.body,
      sources: input.sources.split(/\r?\n/),
      author: input.author,
    });
    if (!result.ok) return { ok: false, message: result.error };

    refreshAfterWrite("/guides", "layout");
    const what = input.section ? `${input.section} ${input.subject}` : input.subject;
    const whose = input.asOperator ? "shared" : "our";
    return {
      ok: true,
      message: result.deleted ? `Cleared the ${whose} ${what} guide.` : `Saved the ${whose} ${what} guide.`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Saving the guide failed." };
  }
}

/** Whether this viewer may write each kind of guide — drives which editors render. */
export async function guidePermissions(): Promise<{ own: boolean; operator: boolean }> {
  return {
    own: can(await resolveViewer(), "guides.edit"),
    operator: isAppAdmin(await resolveViewer()),
  };
}
