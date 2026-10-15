import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { validateBoard } from '../engine/boardRules';
import { runToEnd } from '../engine/simulation';
import { LOCALES } from '../i18n/locales';
import { countPlaced } from './boardOps';
import { applyPlan, TRAPS } from './traps';
import { contentIndexSchema, levelSchema, type Level, type Question } from './schema';
import { buildSimConfig } from './simConfig';
import { applySolution } from './solution';

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

describe('content index', () => {
  test('each entry points to a level with the same id and title', () => {
    index.levels.forEach((entry, position) => {
      expect(levels[position]?.id).toBe(entry.id);
      expect(levels[position]?.title).toEqual(entry.title);
    });
  });

  test('every concept used by a level is in the catalogue', () => {
    const catalog = new Set(index.concepts.map((concept) => concept.id));

    const used = levels.flatMap((level) => level.concepts);

    expect(used.filter((conceptId) => !catalog.has(conceptId))).toEqual([]);
  });

  test('every catalogue concept is worked on in at least two levels', () => {
    for (const concept of index.concepts) {
      const contexts = levels.filter((level) => level.concepts.includes(concept.id));
      expect(contexts.length, concept.id).toBeGreaterThanOrEqual(2);
    }
  });

  test('a delayed unlock points to an earlier level', () => {
    levels.forEach((level, position) => {
      if (!level.unlock) return;
      const earlier = levels.slice(0, position).map((candidate) => candidate.id);
      expect(earlier).toContain(level.unlock.afterLevel);
    });
  });

  test('the review level covers every concept with some question', () => {
    const review = levels.at(-1);
    if (!review) throw new Error('Sem fases.');
    const asked = new Set(allQuestions(review).map((question) => question.conceptId));

    expect(review.concepts.filter((conceptId) => !asked.has(conceptId))).toEqual([]);
  });
});

describe.each(levels)('level $id', (level) => {

  test('the initial board follows the building rules', () => {
    expect(validateBoard(level.initialBoard)).toEqual([]);
  });

  test('explanations exist in both languages and are not copies of each other', () => {
    for (const question of allQuestions(level)) {
      for (const locale of LOCALES) expect(question.explanation[locale].length, question.id).toBeGreaterThan(20);
      expect(question.explanation.en, question.id).not.toBe(question.explanation['pt-BR']);
    }
  });

  test('each loop step has more than one question to rotate', () => {
    const pools = [level.predictQuestions, level.justifyQuestions, ...Object.values(level.diagnoseQuestions)];

    for (const pool of pools) expect(pool?.length).toBeGreaterThanOrEqual(2);
  });

  test('the initial system fails: there is something to predict and fix', () => {
    const result = runToEnd(buildSimConfig(level, level.initialBoard));

    expect(result.passed).toBe(false);
    expect(result.firstViolation).not.toBeNull();
  });

  test('the reference solution meets every SLO within the palette', () => {
    const board = applySolution(level);

    const result = runToEnd(buildSimConfig(level, board));

    expect(validateBoard(board)).toEqual([]);
    for (const [paletteId, count] of Object.entries(countPlaced(board, level))) {
      const item = level.availableComponents.find((candidate) => candidate.id === paletteId);
      expect(count, paletteId).toBeLessThanOrEqual(item?.max ?? 0);
    }
    expect(result.violations).toEqual([]);
    expect(result.passed).toBe(true);
  });

  test('the solution plays out the same on every run', () => {
    const config = buildSimConfig(level, applySolution(level));

    expect(runToEnd(config)).toEqual(runToEnd(config));
  });

  test.each(TRAPS[level.id] ?? [])('shortcut "$name" fails on $violates', (trap) => {
    const board = applyPlan(level, trap.plan);

    const result = runToEnd(buildSimConfig(level, board));

    expect(validateBoard(board)).toEqual([]);
    expect(result.passed).toBe(false);
    expect(result.violations.map((violation) => violation.metric)).toContain(trap.violates);
  });
});
