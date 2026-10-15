import 'fake-indexeddb/auto';
import { describe, expect, test } from 'vitest';
import { IdbProgressRepository } from './idbRepository';
import { deriveConcept, deriveConcepts } from './mastery';
import { parseProgressFile, ProgressFileError, progressFileName, serializeProgress } from './progressFile';
import type { Answer, Clock, LevelProgress } from './types';
import { levelAccess, type LevelGate } from './unlock';

const START = Date.parse('2026-01-01T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const CONCEPT = 'caching';

/** Test clock: time only moves when the test says so. */
class FakeClock implements Clock {
  private ms = START;

  now(): Date {
    return new Date(this.ms);
  }

  advanceDays(days: number): void {
    this.ms += days * DAY_MS;
  }

  advanceHours(hours: number): void {
    this.ms += hours * HOUR_MS;
  }
}

function at(days: number): string {
  return new Date(START + days * DAY_MS).toISOString();
}

function answer(days: number, correct: boolean, levelId = 'level-02', overrides: Partial<Answer> = {}): Answer {
  return {
    conceptId: CONCEPT,
    levelId,
    questionId: `${levelId}-q`,
    stage: 'predict',
    selectedOptionId: 'a',
    correct,
    at: at(days),
    ...overrides,
  };
}

function clockAt(days: number): FakeClock {
  const clock = new FakeClock();
  clock.advanceDays(days);
  return clock;
}

let dbCounter = 0;
function freshRepository(clock: Clock = new FakeClock()): IdbProgressRepository {
  dbCounter += 1;
  return new IdbProgressRepository(clock, `test-db-${dbCounter}`);
}

describe('spaced repetition', () => {
  test('an unanswered concept is new and has no review scheduled', () => {
    const progress = deriveConcept(CONCEPT, [], new FakeClock());

    expect(progress).toMatchObject({ state: 'new', intervalDays: null, nextReviewAt: null, isDue: false });
  });

  test('the first correct answer schedules a review 1 day later', () => {
    const progress = deriveConcept(CONCEPT, [answer(0, true)], clockAt(0));

    expect(progress).toMatchObject({ state: 'practicing', intervalDays: 1, nextReviewAt: at(1), isDue: false });
  });

  test('correct answers on due reviews advance 1, 3, 7 and 16 days and stop at 16', () => {
    const history = [answer(0, true), answer(1, true), answer(4, true), answer(11, true), answer(27, true)];

    const intervals = history.map((_, index) => deriveConcept(CONCEPT, history.slice(0, index + 1), clockAt(0)).intervalDays);

    expect(intervals).toEqual([1, 3, 7, 16, 16]);
  });

  test('a wrong answer resets the interval to 1 day', () => {
    const history = [answer(0, true), answer(1, true), answer(4, true), answer(11, false)];

    const progress = deriveConcept(CONCEPT, history, clockAt(11));

    expect(progress).toMatchObject({ intervalDays: 1, nextReviewAt: at(12) });
  });

  test('a correct answer before the review is due does not advance the interval', () => {
    const sameSession = [answer(0, true), answer(0.01, true), answer(0.02, true)];

    const progress = deriveConcept(CONCEPT, sameSession, clockAt(0.02));

    expect(progress).toMatchObject({ intervalDays: 1, nextReviewAt: at(1), correctCount: 3 });
  });

  test('the review becomes due when the clock passes nextReviewAt', () => {
    const history = [answer(0, true)];
    const clock = new FakeClock();

    const before = deriveConcept(CONCEPT, history, clock).isDue;
    clock.advanceDays(1);
    const after = deriveConcept(CONCEPT, history, clock).isDue;

    expect([before, after]).toEqual([false, true]);
  });

  test('the order answers were stored in does not matter, only their date', () => {
    const history = [answer(0, true), answer(1, true), answer(4, false)];

    const ordered = deriveConcept(CONCEPT, history, clockAt(5));
    const shuffled = deriveConcept(CONCEPT, [...history].reverse(), clockAt(5));

    expect(shuffled).toEqual(ordered);
  });

  test('answers to other concepts do not count', () => {
    const other = answer(0, true, 'level-02', { conceptId: 'rate-limiting' });

    const [caching, limiting] = deriveConcepts([CONCEPT, 'rate-limiting'], [other], clockAt(0));

    expect(caching?.state).toBe('new');
    expect(limiting?.state).toBe('practicing');
  });
});

describe('mastery', () => {
  test('correct in two levels 3 or more days apart masters the concept', () => {
    const history = [answer(0, true, 'level-02'), answer(3, true, 'level-04')];

    const progress = deriveConcept(CONCEPT, history, clockAt(3));

    expect(progress.state).toBe('mastered');
    expect(progress.contexts).toEqual(['level-02', 'level-04']);
  });

  test('correct in two levels one day apart is not mastery yet', () => {
    const history = [answer(0, true, 'level-02'), answer(1, true, 'level-04')];

    expect(deriveConcept(CONCEPT, history, clockAt(1)).state).toBe('practicing');
  });

  test('correct many times in the same level is not mastery, even days apart', () => {
    const history = [answer(0, true), answer(1, true), answer(4, true), answer(11, true)];

    expect(deriveConcept(CONCEPT, history, clockAt(11)).state).toBe('practicing');
  });

  test('the interval counts from the first correct answer, not the first answer', () => {
    const history = [answer(0, false, 'level-02'), answer(2, true, 'level-02'), answer(4, true, 'level-04')];

    expect(deriveConcept(CONCEPT, history, clockAt(4)).state).toBe('practicing');
  });

  test('a later wrong answer revokes mastery until answered correctly again', () => {
    const mastered = [answer(0, true, 'level-02'), answer(3, true, 'level-04')];

    const slipped = deriveConcept(CONCEPT, [...mastered, answer(10, false, 'level-04')], clockAt(10));
    const recovered = deriveConcept(CONCEPT, [...mastered, answer(10, false, 'level-04'), answer(11, true, 'level-04')], clockAt(11));

    expect(slipped.state).toBe('practicing');
    expect(recovered.state).toBe('mastered');
  });
});

describe('level unlocking', () => {
  const levels: LevelGate[] = [
    { id: 'level-01' },
    { id: 'level-02' },
    { id: 'level-03' },
    { id: 'level-04', unlock: { afterLevel: 'level-03', delayHours: 24 } },
  ];
  const done = (levelId: string, days: number): LevelProgress => ({ levelId, runs: 1, completedAt: at(days) });

  test('the first level is always open', () => {
    expect(levelAccess(levels, 'level-01', [], new FakeClock())).toEqual({ status: 'open' });
  });

  test('each level requires the previous one completed', () => {
    const started: LevelProgress = { levelId: 'level-01', runs: 3, completedAt: null };

    expect(levelAccess(levels, 'level-02', [started], new FakeClock())).toEqual({ status: 'locked', requires: 'level-01' });
    expect(levelAccess(levels, 'level-02', [done('level-01', 0)], new FakeClock())).toEqual({ status: 'open' });
  });

  test('the review level waits 24 hours after level 3', () => {
    const progress = [done('level-01', 0), done('level-02', 0), done('level-03', 0)];
    const clock = new FakeClock();

    const sameDay = levelAccess(levels, 'level-04', progress, clock);
    clock.advanceHours(23);
    const almost = levelAccess(levels, 'level-04', progress, clock);
    clock.advanceHours(1);
    const nextDay = levelAccess(levels, 'level-04', progress, clock);

    expect(sameDay).toEqual({ status: 'waiting', availableAt: at(1) });
    expect(almost.status).toBe('waiting');
    expect(nextDay).toEqual({ status: 'open' });
  });

  test('an unknown level stays locked', () => {
    expect(levelAccess(levels, 'level-99', [], new FakeClock()).status).toBe('locked');
  });
});

describe('IdbProgressRepository', () => {
  test('stores and lists answers in arrival order', async () => {
    const repository = freshRepository();

    await repository.recordAnswer(answer(0, true));
    await repository.recordAnswer(answer(1, false));

    expect((await repository.listAnswers()).map((entry) => entry.correct)).toEqual([true, false]);
  });

  test('rejects an answer outside the schema', async () => {
    const repository = freshRepository();

    await expect(repository.recordAnswer(answer(0, true, 'level-02', { at: 'ontem' }))).rejects.toThrow();
  });

  test('level progress is replaced by the latest one', async () => {
    const repository = freshRepository();

    await repository.saveLevelProgress({ levelId: 'level-01', runs: 1, completedAt: null });
    await repository.saveLevelProgress({ levelId: 'level-01', runs: 2, completedAt: at(0) });

    expect(await repository.listLevelProgress()).toEqual([{ levelId: 'level-01', runs: 2, completedAt: at(0) }]);
  });

  test('settings have defaults and persist', async () => {
    const repository = freshRepository();

    const initial = await repository.getSettings();
    await repository.saveSettings({ locale: 'pt-BR' });

    expect(initial).toEqual({ locale: null });
    expect(await repository.getSettings()).toEqual({ locale: 'pt-BR' });
  });

  test('exporting and importing on another device keeps everything', async () => {
    const source = freshRepository(clockAt(2));
    await source.recordAnswer(answer(0, true));
    await source.saveLevelProgress({ levelId: 'level-01', runs: 4, completedAt: at(1) });
    await source.saveSettings({ locale: 'en' });
    const target = freshRepository();
    await target.recordAnswer(answer(0, false, 'level-03'));

    const exported = await source.exportAll();
    await target.importAll(parseProgressFile(serializeProgress(exported)));

    expect(exported.exportedAt).toBe(at(2));
    expect(await target.exportAll()).toMatchObject({
      answers: exported.answers,
      levels: exported.levels,
      settings: exported.settings,
    });
  });

  test('clear deletes answers, levels and settings', async () => {
    const repository = freshRepository();
    await repository.recordAnswer(answer(0, true));
    await repository.saveLevelProgress({ levelId: 'level-01', runs: 1, completedAt: null });
    await repository.saveSettings({ locale: 'en' });

    await repository.clear();

    expect(await repository.listAnswers()).toEqual([]);
    expect(await repository.listLevelProgress()).toEqual([]);
    expect(await repository.getSettings()).toEqual({ locale: null });
  });
});

describe('progress file', () => {
  test('rejects text that is not JSON', () => {
    expect(() => parseProgressFile('not json')).toThrow(ProgressFileError);
  });

  test('rejects JSON of another format', () => {
    expect(() => parseProgressFile(JSON.stringify({ format: 'another-game', version: 1 }))).toThrow(/progress file for this game/);
  });

  test('the file name carries the export date', () => {
    expect(progressFileName(at(0))).toBe('playsysdesigner-progress-2026-01-01.json');
  });
});
