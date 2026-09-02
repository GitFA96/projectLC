import Link from "next/link";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { PROFESSION_SHORT_LABELS } from "@/lib/constants/wow";
import type { Profession } from "@/lib/types";
import type { ProfessionGap } from "@/lib/analysis/professions";
import { cn } from "@/lib/utils";

/**
 * What a character's professions look like wherever they are shown.
 *
 * One component for the roster and the profile so the two cannot drift into
 * saying the same thing two ways. The only difference between them is how much
 * room there is, which is what `compact` means — never what is shown.
 */
export function ProfessionBadges({
  professions,
  compact = false,
}: {
  professions: readonly Profession[];
  /** Abbreviate, for a table cell that also holds a name and a class. */
  compact?: boolean;
}) {
  if (professions.length === 0) return null;
  return (
    <>
      {professions.map((p) => (
        <Badge key={p} variant="muted" title={`Profession: ${p}`}>
          {compact ? PROFESSION_SHORT_LABELS[p] : p}
        </Badge>
      ))}
    </>
  );
}

/**
 * The prompt to record a profession the logs already prove.
 *
 * A question mark rather than a warning, because that is the actual state: the
 * app is not correcting the officer, it is asking a question it found an answer
 * to. `professionGap` only ever fires on positive evidence, so this never
 * appears against a raider whose professions are recorded — including one
 * recorded as having none of it.
 *
 * It links to the edit form, which is where the answer goes. The link is shown
 * to anyone who can see the character, exactly like the profile's own Edit
 * button: the edit page gates itself on `roster.edit` and a raider who follows
 * it is told so, which is a better answer than a prompt that silently does
 * nothing for the person most likely to know whether it is right.
 */
export function ProfessionGapBadge({
  gap,
  characterName,
}: {
  gap: ProfessionGap;
  characterName: string;
}) {
  return (
    <Link
      href={`/characters/${encodeURIComponent(characterName.toLowerCase())}/edit`}
      className={cn(badgeVariants({ variant: "info" }), "hover:brightness-95")}
      title={
        `${characterName} set off ${gap.explosives} engineering explosive` +
        `${gap.explosives === 1 ? "" : "s"} in an imported log — a sapper charge or an Arcane ` +
        `Bomb, each of which takes ${gap.profession} — but the roster doesn't record it. ` +
        `Click to set it. (The reverse isn't true: never throwing one proves nothing.)`
      }
    >
      {gap.profession}?
    </Link>
  );
}
