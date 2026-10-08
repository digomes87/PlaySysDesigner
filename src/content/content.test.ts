import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { validateBoard } from '../engine/boardRules';
import { runToEnd } from '../engine/simulation';
import { LOCALES } from '../i18n/locales';
import { countPlaced } from './boardOps';
import { applyPlan, REFERENCE_SOLUTIONS, TRAPS } from './referenceSolutions';
import { contentIndexSchema, levelSchema, type Level, type Question } from './schema';
import { buildSimConfig } from './simConfig';

const CONTENT_DIR = join(process.cwd(), 'public', 'content');

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(join(CONTENT_DIR, relativePath), 'utf8'));
}

function allQuestions(level: Level): Question[] {
  return [level.predictQuestions, level.justifyQuestions, ...Object.values(level.diagnoseQuestions)].flatMap(
    (pool) => pool ?? [],
  );
}

const index = contentIndexSchema.parse(readJson('index.json'));
const levels: Level[] = index.levels.map((entry) => levelSchema.parse(readJson(entry.file)));

describe('índice do conteúdo', () => {
  test('cada entrada aponta para uma fase com o mesmo id e título', () => {
    index.levels.forEach((entry, position) => {
      expect(levels[position]?.id).toBe(entry.id);
      expect(levels[position]?.title).toEqual(entry.title);
    });
  });

  test('todo conceito usado por uma fase está no catálogo', () => {
    const catalog = new Set(index.concepts.map((concept) => concept.id));

    const used = levels.flatMap((level) => level.concepts);

    expect(used.filter((conceptId) => !catalog.has(conceptId))).toEqual([]);
  });

  test('todo conceito do catálogo é trabalhado em pelo menos duas fases', () => {
    for (const concept of index.concepts) {
      const contexts = levels.filter((level) => level.concepts.includes(concept.id));
      expect(contexts.length, concept.id).toBeGreaterThanOrEqual(2);
    }
  });

  test('desbloqueio com atraso aponta para uma fase anterior', () => {
    levels.forEach((level, position) => {
      if (!level.unlock) return;
      const earlier = levels.slice(0, position).map((candidate) => candidate.id);
      expect(earlier).toContain(level.unlock.afterLevel);
    });
  });

  test('a fase de revisão cobre cada conceito com alguma pergunta', () => {
    const review = levels.at(-1);
    if (!review) throw new Error('Sem fases.');
    const asked = new Set(allQuestions(review).map((question) => question.conceptId));

    expect(review.concepts.filter((conceptId) => !asked.has(conceptId))).toEqual([]);
  });
});

describe.each(levels)('fase $id', (level) => {
  const solutionPlan = REFERENCE_SOLUTIONS[level.id];

  test('tabuleiro inicial respeita as regras de montagem', () => {
    expect(validateBoard(level.initialBoard)).toEqual([]);
  });

  test('explicações existem nos dois idiomas e não são cópia uma da outra', () => {
    for (const question of allQuestions(level)) {
      for (const locale of LOCALES) expect(question.explanation[locale].length, question.id).toBeGreaterThan(20);
      expect(question.explanation.en, question.id).not.toBe(question.explanation['pt-BR']);
    }
  });

  test('cada etapa do loop tem mais de uma pergunta para revezar', () => {
    const pools = [level.predictQuestions, level.justifyQuestions, ...Object.values(level.diagnoseQuestions)];

    for (const pool of pools) expect(pool?.length).toBeGreaterThanOrEqual(2);
  });

  test('o sistema inicial falha: há o que prever e o que consertar', () => {
    const result = runToEnd(buildSimConfig(level, level.initialBoard));

    expect(result.passed).toBe(false);
    expect(result.firstViolation).not.toBeNull();
  });

  test('a solução de referência cumpre todos os SLOs dentro da paleta', () => {
    if (!solutionPlan) throw new Error(`Sem solução de referência para ${level.id}.`);
    const board = applyPlan(level, solutionPlan);

    const result = runToEnd(buildSimConfig(level, board));

    expect(validateBoard(board)).toEqual([]);
    for (const [paletteId, count] of Object.entries(countPlaced(board, level))) {
      const item = level.availableComponents.find((candidate) => candidate.id === paletteId);
      expect(count, paletteId).toBeLessThanOrEqual(item?.max ?? 0);
    }
    expect(result.violations).toEqual([]);
    expect(result.passed).toBe(true);
  });

  test('a solução é a mesma partida a cada execução', () => {
    if (!solutionPlan) throw new Error(`Sem solução de referência para ${level.id}.`);
    const config = buildSimConfig(level, applyPlan(level, solutionPlan));

    expect(runToEnd(config)).toEqual(runToEnd(config));
  });

  test.each(TRAPS[level.id] ?? [])('atalho "$name" reprova por $violates', (trap) => {
    const board = applyPlan(level, trap.plan);

    const result = runToEnd(buildSimConfig(level, board));

    expect(validateBoard(board)).toEqual([]);
    expect(result.passed).toBe(false);
    expect(result.violations.map((violation) => violation.metric)).toContain(trap.violates);
  });
});
