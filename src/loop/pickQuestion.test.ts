import { describe, expect, test } from 'vitest';
import type { Question } from '../content/schema';
import type { Answer } from '../progress/types';
import { pickQuestion } from './pickQuestion';

function question(id: string): Question {
  const text = { 'pt-BR': id, en: id };
  return {
    id,
    conceptId: 'caching',
    prompt: text,
    options: ['a', 'b', 'c'].map((optionId) => ({ id: optionId, text })),
    correctOptionId: 'a',
    explanation: text,
  };
}

function answered(questionId: string, minute: number): Answer {
  return {
    conceptId: 'caching',
    levelId: 'level-02',
    questionId,
    stage: 'diagnose',
    selectedOptionId: 'a',
    correct: true,
    at: new Date(Date.UTC(2026, 0, 1, 12, minute)).toISOString(),
  };
}

const POOL = [question('q1'), question('q2'), question('q3')];

describe('pickQuestion', () => {
  test('an empty pool has no question', () => {
    expect(pickQuestion([], [])).toBeNull();
  });

  test('without answers, it starts with the first in content order', () => {
    expect(pickQuestion(POOL, [])?.id).toBe('q1');
  });

  test('a never-seen question comes before answered ones', () => {
    expect(pickQuestion(POOL, [answered('q1', 0)])?.id).toBe('q2');
    expect(pickQuestion(POOL, [answered('q1', 0), answered('q2', 1)])?.id).toBe('q3');
  });

  test('with all seen, it goes back to the one seen longest ago', () => {
    const answers = [answered('q1', 0), answered('q2', 1), answered('q3', 2), answered('q1', 3)];

    expect(pickQuestion(POOL, answers)?.id).toBe('q2');
  });

  test('answers to another pool do not interfere', () => {
    expect(pickQuestion(POOL, [answered('outra', 0)])?.id).toBe('q1');
  });
});
