import {
  bumpDataVersion,
  getDb,
  setGuide,
  deleteGuide,
  setGuildPolicy,
  withTx,
} from "@/lib/data/db";
import type { GuideKind } from "@/lib/guides";
import { CLASS_SPECS, WOW_CLASSES } from "@/lib/constants/wow";
import type { PolicyOverrides } from "@/lib/analysis/policy";
import { phaseSchema } from "@/lib/import/schemas";
import type { WriteRepo } from "@/lib/data/repo";
import type { Phase } from "@/lib/types";
import type { Writes } from "./model";

/**
 * What the guild decides for itself: the phase it is progressing, the policy
 * its verdicts are scored under, and the guides it writes.
 *
 * A policy field the sanitizer in `db/meta/policy.ts` does not name is dropped
 * on read — the editor saves, the page reloads, and the number is back to its
 * default with no error anywhere (change-chains §4b). Adding one is a chain,
 * not an edit; the `add-policy-field` skill walks it.
 */

export const guildWrites = {
  async setActivePhase(phase: Phase) {
    const parsed = phaseSchema.safeParse(phase);
    if (!parsed.success) return { ok: false as const, error: "That isn't a phase this app knows." };
    const db = getDb();
    withTx(db, () => {
      db.prepare("UPDATE guild SET active_phase = ?").run(parsed.data);
      // Everything phase-scoped is derived, so the read model has to rebuild.
      bumpDataVersion(db);
    });
    return { ok: true as const };
  },

  async setGuildPolicy(overrides: PolicyOverrides) {
    // A weighting that is zero everywhere would divide by zero and rank nobody.
    // Every other field is clamped on write, so this is the only cross-field
    // rule the record has.
    const weights = overrides.weights;
    if (weights) {
      const given = Object.values(weights).filter((v) => typeof v === "number");
      if (given.length > 0 && given.every((v) => v === 0)) {
        return { ok: false as const, error: "At least one factor has to carry some weight." };
      }
    }
    const db = getDb();
    withTx(db, () => {
      setGuildPolicy(db, overrides);
      // The policy is baked into the read model — force a rebuild.
      bumpDataVersion(db);
    });
    return { ok: true as const };
  },

  async setGuide(input: {
    kind: GuideKind;
    subject: string;
    section: string;
    owner: string;
    body: string;
    sources: string[];
    author?: string;
  }) {
    const section = input.section.trim();
    // A class guide's subject and section are a closed set, so a typo is a
    // refusal rather than a row nobody will ever find. A raid guide's are not:
    // the boss list gains rows, and an operator writing about something the
    // table has not heard of yet is the same judgement call as a note on a
    // drop source nobody has named. See `addBossComment`.
    if (input.kind === "class") {
      if (!WOW_CLASSES.includes(input.subject as (typeof WOW_CLASSES)[number])) {
        return { ok: false as const, error: `${input.subject} isn't a class this app knows.` };
      }
      if (section && !CLASS_SPECS[input.subject as (typeof WOW_CLASSES)[number]].includes(section)) {
        return { ok: false as const, error: `${input.subject} has no spec called "${section}".` };
      }
    }
    if (!input.subject.trim()) {
      return { ok: false as const, error: "A guide needs a subject." };
    }
    if (!input.owner.trim()) {
      return { ok: false as const, error: "A guide needs an owner." };
    }
    const db = getDb();
    const body = input.body.trim();
    // An empty guide is deleted rather than stored: a blank body would read as
    // "we looked at this and had nothing to say", which is a different claim
    // from "nobody has written it yet".
    if (!body) {
      let deleted = false;
      withTx(db, () => {
        deleted = deleteGuide(db, input.kind, input.subject, section, input.owner);
        if (deleted) bumpDataVersion(db);
      });
      return { ok: true as const, deleted };
    }
    withTx(db, () => {
      setGuide(db, {
        kind: input.kind,
        subject: input.subject,
        section,
        owner: input.owner,
        body,
        sources: input.sources.map((x) => x.trim()).filter(Boolean),
        author: input.author?.trim() || undefined,
      });
      bumpDataVersion(db);
    });
    return { ok: true as const, deleted: false };
  },
} satisfies Partial<Writes> & ThisType<WriteRepo>;
