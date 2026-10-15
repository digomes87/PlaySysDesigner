import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import { levelSchema } from '../content/schema';
import { applySolution } from '../content/solution';
import type { SimResult } from '../engine/types';
import { FAILED_RUNS_BEFORE_SOLUTION, isSolutionUnlocked, useGameStore } from './gameStore';

const level = levelSchema.parse(
  JSON.parse(readFileSync(join(process.cwd(), 'public', 'content', 'levels', 'level-01.json'), 'utf8')),
);

const failedRun = {
  passed: false,
  firstViolation: { metric: 'p99LatencyMs', atSec: 10, value: 999 },
} as unknown as SimResult;
const passedRun = { passed: true, firstViolation: null } as unknown as SimResult;

function failRuns(count: number): void {
  for (let run = 0; run < count; run += 1) {
    useGameStore.getState().finishRun(failedRun, []);
    useGameStore.getState().goTo('build');
  }
}

describe('reference solution', () => {
  beforeEach(() => {
    useGameStore.getState().begin(level, []);
    useGameStore.getState().goTo('build');
  });

  test(`unlocks only after ${FAILED_RUNS_BEFORE_SOLUTION} failed runs`, () => {
    failRuns(FAILED_RUNS_BEFORE_SOLUTION - 1);
    expect(isSolutionUnlocked(useGameStore.getState())).toBe(false);

    failRuns(1);
    expect(isSolutionUnlocked(useGameStore.getState())).toBe(true);
  });

  test('showing it does nothing while it is still locked', () => {
    useGameStore.getState().showSolution();

    expect(useGameStore.getState().stage).toBe('build');
    expect(useGameStore.getState().board).toEqual(level.initialBoard);
  });

  test('showing it loads the reference board and runs it', () => {
    failRuns(FAILED_RUNS_BEFORE_SOLUTION);

    useGameStore.getState().showSolution();

    expect(useGameStore.getState().stage).toBe('run');
    expect(useGameStore.getState().board).toEqual(applySolution(level));
  });

  test('a passing run of the solution does not lead to justify or completion', () => {
    failRuns(FAILED_RUNS_BEFORE_SOLUTION);
    useGameStore.getState().showSolution();

    useGameStore.getState().finishRun(passedRun, []);

    expect(useGameStore.getState().stage).toBe('solution');
  });

  test('leaving the solution hands back the initial board to build it yourself', () => {
    failRuns(FAILED_RUNS_BEFORE_SOLUTION);
    useGameStore.getState().showSolution();
    useGameStore.getState().finishRun(passedRun, []);

    useGameStore.getState().leaveSolution();

    expect(useGameStore.getState().stage).toBe('build');
    expect(useGameStore.getState().board).toEqual(level.initialBoard);
    useGameStore.getState().finishRun(passedRun, []);
    expect(useGameStore.getState().stage).toBe('justify');
  });
});
