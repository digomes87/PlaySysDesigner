import type { Question } from '../content/schema';
import type { Answer } from '../progress/types';

/**
 * Picks the pool question the player saw longest ago; never-seen ones
 * come first, in content order. So failing and retrying brings a different
 * question instead of letting the player memorise the answer.
 */
export function pickQuestion(pool: readonly Question[], answers: readonly Answer[]): Question | null {
  const lastSeen = new Map<string, number>();
  for (const answer of answers) {
    const at = Date.parse(answer.at);
    if (at > (lastSeen.get(answer.questionId) ?? Number.NEGATIVE_INFINITY)) lastSeen.set(answer.questionId, at);
  }
  let chosen: Question | null = null;
  let chosenSeen = Number.POSITIVE_INFINITY;
  for (const question of pool) {
    const seen = lastSeen.get(question.id) ?? Number.NEGATIVE_INFINITY;
    if (seen < chosenSeen) {
      chosen = question;
      chosenSeen = seen;
    }
  }
  return chosen;
}
