import type { AwardWithContext, Character, FairnessEntry, Phase } from "@/lib/types";

/**
 * On-spec / off-spec award counts per character (optionally restricted to a phase,
 * attributed by raid zone). Zero-award raiders are included — that IS the signal.
 * Pugs are excluded: fairness is about distributing loot within the guild.
 */
export function computeFairness(
  characters: Character[],
  awards: AwardWithContext[],
  phase?: Phase,
): FairnessEntry[] {
  const relevant = phase ? awards.filter((a) => a.sessionPhase === phase) : awards;
  const entries = characters
    .filter((c) => c.status !== "inactive" && c.status !== "pug")
    .map((character) => {
      const theirs = relevant.filter((a) => a.award.characterId === character.id);
      return {
        character,
        onSpec: theirs.filter((a) => !a.award.offspec).length,
        offSpec: theirs.filter((a) => a.award.offspec).length,
      };
    });
  return entries.sort(
    (a, b) => b.onSpec - a.onSpec || b.offSpec - a.offSpec || a.character.name.localeCompare(b.character.name),
  );
}
