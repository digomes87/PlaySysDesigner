import type { Question } from '../content/schema';
import type { Answer } from '../progress/types';

/**
 * Escolhe a pergunta do banco que o jogador viu há mais tempo; as nunca vistas
 * vêm primeiro, na ordem do conteúdo. Assim, errar e tentar de novo traz uma
 * pergunta diferente em vez de deixar decorar a resposta.
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
