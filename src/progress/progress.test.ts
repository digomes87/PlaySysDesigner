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

/** Relógio de teste: o tempo só anda quando o teste manda. */
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

describe('repetição espaçada', () => {
  test('conceito sem resposta é novo e não tem revisão marcada', () => {
    const progress = deriveConcept(CONCEPT, [], new FakeClock());

    expect(progress).toMatchObject({ state: 'new', intervalDays: null, nextReviewAt: null, isDue: false });
  });

  test('primeiro acerto marca revisão para 1 dia depois', () => {
    const progress = deriveConcept(CONCEPT, [answer(0, true)], clockAt(0));

    expect(progress).toMatchObject({ state: 'practicing', intervalDays: 1, nextReviewAt: at(1), isDue: false });
  });

  test('acertos nas revisões vencidas avançam 1, 3, 7 e 16 dias e param em 16', () => {
    const history = [answer(0, true), answer(1, true), answer(4, true), answer(11, true), answer(27, true)];

    const intervals = history.map((_, index) => deriveConcept(CONCEPT, history.slice(0, index + 1), clockAt(0)).intervalDays);

    expect(intervals).toEqual([1, 3, 7, 16, 16]);
  });

  test('erro volta o intervalo para 1 dia', () => {
    const history = [answer(0, true), answer(1, true), answer(4, true), answer(11, false)];

    const progress = deriveConcept(CONCEPT, history, clockAt(11));

    expect(progress).toMatchObject({ intervalDays: 1, nextReviewAt: at(12) });
  });

  test('acerto antes da revisão vencer não avança o intervalo', () => {
    const sameSession = [answer(0, true), answer(0.01, true), answer(0.02, true)];

    const progress = deriveConcept(CONCEPT, sameSession, clockAt(0.02));

    expect(progress).toMatchObject({ intervalDays: 1, nextReviewAt: at(1), correctCount: 3 });
  });

  test('revisão vence quando o relógio passa de nextReviewAt', () => {
    const history = [answer(0, true)];
    const clock = new FakeClock();

    const before = deriveConcept(CONCEPT, history, clock).isDue;
    clock.advanceDays(1);
    const after = deriveConcept(CONCEPT, history, clock).isDue;

    expect([before, after]).toEqual([false, true]);
  });

  test('a ordem em que as respostas foram gravadas não importa, só a data', () => {
    const history = [answer(0, true), answer(1, true), answer(4, false)];

    const ordered = deriveConcept(CONCEPT, history, clockAt(5));
    const shuffled = deriveConcept(CONCEPT, [...history].reverse(), clockAt(5));

    expect(shuffled).toEqual(ordered);
  });

  test('respostas de outros conceitos não contam', () => {
    const other = answer(0, true, 'level-02', { conceptId: 'rate-limiting' });

    const [caching, limiting] = deriveConcepts([CONCEPT, 'rate-limiting'], [other], clockAt(0));

    expect(caching?.state).toBe('new');
    expect(limiting?.state).toBe('practicing');
  });
});

describe('domínio', () => {
  test('acertar em duas fases com 3 dias ou mais entre os acertos domina o conceito', () => {
    const history = [answer(0, true, 'level-02'), answer(3, true, 'level-04')];

    const progress = deriveConcept(CONCEPT, history, clockAt(3));

    expect(progress.state).toBe('mastered');
    expect(progress.contexts).toEqual(['level-02', 'level-04']);
  });

  test('acertar em duas fases com um dia de diferença ainda não é domínio', () => {
    const history = [answer(0, true, 'level-02'), answer(1, true, 'level-04')];

    expect(deriveConcept(CONCEPT, history, clockAt(1)).state).toBe('practicing');
  });

  test('acertar várias vezes na mesma fase não é domínio, nem com dias de intervalo', () => {
    const history = [answer(0, true), answer(1, true), answer(4, true), answer(11, true)];

    expect(deriveConcept(CONCEPT, history, clockAt(11)).state).toBe('practicing');
  });

  test('o intervalo conta do primeiro acerto, não da primeira resposta', () => {
    const history = [answer(0, false, 'level-02'), answer(2, true, 'level-02'), answer(4, true, 'level-04')];

    expect(deriveConcept(CONCEPT, history, clockAt(4)).state).toBe('practicing');
  });

  test('errar depois derruba o domínio até acertar de novo', () => {
    const mastered = [answer(0, true, 'level-02'), answer(3, true, 'level-04')];

    const slipped = deriveConcept(CONCEPT, [...mastered, answer(10, false, 'level-04')], clockAt(10));
    const recovered = deriveConcept(CONCEPT, [...mastered, answer(10, false, 'level-04'), answer(11, true, 'level-04')], clockAt(11));

    expect(slipped.state).toBe('practicing');
    expect(recovered.state).toBe('mastered');
  });
});

describe('desbloqueio de fases', () => {
  const levels: LevelGate[] = [
    { id: 'level-01' },
    { id: 'level-02' },
    { id: 'level-03' },
    { id: 'level-04', unlock: { afterLevel: 'level-03', delayHours: 24 } },
  ];
  const done = (levelId: string, days: number): LevelProgress => ({ levelId, runs: 1, completedAt: at(days) });

  test('a primeira fase está sempre aberta', () => {
    expect(levelAccess(levels, 'level-01', [], new FakeClock())).toEqual({ status: 'open' });
  });

  test('cada fase exige a anterior concluída', () => {
    const started: LevelProgress = { levelId: 'level-01', runs: 3, completedAt: null };

    expect(levelAccess(levels, 'level-02', [started], new FakeClock())).toEqual({ status: 'locked', requires: 'level-01' });
    expect(levelAccess(levels, 'level-02', [done('level-01', 0)], new FakeClock())).toEqual({ status: 'open' });
  });

  test('a revisão espera 24 horas depois da fase 3', () => {
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

  test('fase desconhecida fica trancada', () => {
    expect(levelAccess(levels, 'level-99', [], new FakeClock()).status).toBe('locked');
  });
});

describe('IdbProgressRepository', () => {
  test('grava e lista respostas na ordem em que chegaram', async () => {
    const repository = freshRepository();

    await repository.recordAnswer(answer(0, true));
    await repository.recordAnswer(answer(1, false));

    expect((await repository.listAnswers()).map((entry) => entry.correct)).toEqual([true, false]);
  });

  test('recusa resposta fora do schema', async () => {
    const repository = freshRepository();

    await expect(repository.recordAnswer(answer(0, true, 'level-02', { at: 'ontem' }))).rejects.toThrow();
  });

  test('progresso de fase é substituído pelo mais recente', async () => {
    const repository = freshRepository();

    await repository.saveLevelProgress({ levelId: 'level-01', runs: 1, completedAt: null });
    await repository.saveLevelProgress({ levelId: 'level-01', runs: 2, completedAt: at(0) });

    expect(await repository.listLevelProgress()).toEqual([{ levelId: 'level-01', runs: 2, completedAt: at(0) }]);
  });

  test('configurações têm padrão e persistem', async () => {
    const repository = freshRepository();

    const initial = await repository.getSettings();
    await repository.saveSettings({ locale: 'pt-BR' });

    expect(initial).toEqual({ locale: null });
    expect(await repository.getSettings()).toEqual({ locale: 'pt-BR' });
  });

  test('exportar e importar em outro aparelho preserva tudo', async () => {
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

  test('clear apaga respostas, fases e configurações', async () => {
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

describe('arquivo de progresso', () => {
  test('recusa texto que não é JSON', () => {
    expect(() => parseProgressFile('não é json')).toThrow(ProgressFileError);
  });

  test('recusa JSON de outro formato', () => {
    expect(() => parseProgressFile(JSON.stringify({ format: 'outro-jogo', version: 1 }))).toThrow(/deste jogo/);
  });

  test('nome do arquivo leva a data da exportação', () => {
    expect(progressFileName(at(0))).toBe('playsysdesigner-progress-2026-01-01.json');
  });
});
