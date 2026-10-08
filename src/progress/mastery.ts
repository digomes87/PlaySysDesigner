import type { Answer, Clock } from './types';

export const REVIEW_INTERVALS_DAYS = [1, 3, 7, 16] as const;
/** Tempo mínimo entre o primeiro acerto e o acerto em outro contexto para contar como domínio. */
export const MASTERY_MIN_GAP_DAYS = 3;
export const MASTERY_MIN_CONTEXTS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

export type ConceptState = 'new' | 'practicing' | 'mastered';

export interface ConceptProgress {
  readonly conceptId: string;
  readonly state: ConceptState;
  /** Intervalo de revisão em vigor; null enquanto o conceito nunca foi respondido. */
  readonly intervalDays: number | null;
  readonly nextReviewAt: string | null;
  /** A revisão venceu: já passou de `nextReviewAt`. */
  readonly isDue: boolean;
  readonly correctCount: number;
  readonly totalCount: number;
  readonly lastAnsweredAt: string | null;
  /** Fases em que o conceito já foi acertado. */
  readonly contexts: readonly string[];
}

interface Schedule {
  readonly intervalIndex: number;
  readonly nextReviewMs: number;
}

function time(answer: Answer): number {
  return Date.parse(answer.at);
}

function byTime(a: Answer, b: Answer): number {
  return time(a) - time(b);
}

/**
 * Repetição espaçada. Errou: volta para 1 dia. Acertou com a revisão vencida (ou
 * na primeira resposta): avança um intervalo. Acertou antes da hora: nada muda,
 * senão responder duas perguntas na mesma sessão pularia intervalos.
 */
function schedule(answers: readonly Answer[]): Schedule | null {
  let current: Schedule | null = null;
  for (const answer of answers) {
    const at = time(answer);
    if (!answer.correct) {
      current = { intervalIndex: 0, nextReviewMs: at + REVIEW_INTERVALS_DAYS[0] * DAY_MS };
      continue;
    }
    if (current !== null && at < current.nextReviewMs) continue;
    const intervalIndex: number = current === null ? 0 : Math.min(current.intervalIndex + 1, REVIEW_INTERVALS_DAYS.length - 1);
    current = { intervalIndex, nextReviewMs: at + (REVIEW_INTERVALS_DAYS[intervalIndex] ?? 1) * DAY_MS };
  }
  return current;
}

/**
 * Domínio por tempo real: acerto em pelo menos 2 fases diferentes, com pelo menos
 * 3 dias entre o primeiro acerto e um acerto em outra fase. Errar depois derruba
 * o domínio até o conceito ser acertado de novo.
 */
function isMastered(answers: readonly Answer[]): boolean {
  const correct = answers.filter((answer) => answer.correct);
  const first = correct[0];
  const last = answers.at(-1);
  if (!first || !last?.correct) return false;
  const contexts = new Set(correct.map((answer) => answer.levelId));
  if (contexts.size < MASTERY_MIN_CONTEXTS) return false;
  return correct.some(
    (answer) => answer.levelId !== first.levelId && time(answer) - time(first) >= MASTERY_MIN_GAP_DAYS * DAY_MS,
  );
}

export function deriveConcept(conceptId: string, allAnswers: readonly Answer[], clock: Clock): ConceptProgress {
  const answers = allAnswers.filter((answer) => answer.conceptId === conceptId).sort(byTime);
  const current = schedule(answers);
  const correct = answers.filter((answer) => answer.correct);
  const state: ConceptState = answers.length === 0 ? 'new' : isMastered(answers) ? 'mastered' : 'practicing';
  return {
    conceptId,
    state,
    intervalDays: current ? (REVIEW_INTERVALS_DAYS[current.intervalIndex] ?? null) : null,
    nextReviewAt: current ? new Date(current.nextReviewMs).toISOString() : null,
    isDue: current !== null && clock.now().getTime() >= current.nextReviewMs,
    correctCount: correct.length,
    totalCount: answers.length,
    lastAnsweredAt: answers.at(-1)?.at ?? null,
    contexts: [...new Set(correct.map((answer) => answer.levelId))],
  };
}

export function deriveConcepts(conceptIds: readonly string[], answers: readonly Answer[], clock: Clock): ConceptProgress[] {
  return conceptIds.map((conceptId) => deriveConcept(conceptId, answers, clock));
}
