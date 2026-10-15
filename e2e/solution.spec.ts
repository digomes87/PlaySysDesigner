import { expect, test } from '@playwright/test';
import { answerAndContinue, backToBuild, openLevel, runToEnd } from './support/loop';
import { storedCompletion } from './support/progress';

const FAILED_RUNS_BEFORE_SOLUTION = 3;
const INITIAL_NODE_COUNT = 3;

test('after three failed runs the reference solution plays without completing the level', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await openLevel(page, 'level-01');
  await answerAndContinue(page, 'Go to the board');
  const showSolution = page.getByRole('button', { name: 'Show solution' });

  for (let run = 1; run <= FAILED_RUNS_BEFORE_SOLUTION; run += 1) {
    await expect(showSolution).toHaveCount(0);
    expect(await runToEnd(page)).toBe('failed');
    await backToBuild(page);
  }

  await showSolution.click();
  await page.getByRole('button', { name: /Skip to the end/ }).click();
  await expect(page.getByText('Reference solution')).toBeVisible();
  expect(await storedCompletion(page, 'level-01')).toBeNull();

  await page.getByRole('button', { name: /Build it yourself/ }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(INITIAL_NODE_COUNT);
  await expect(page.getByRole('button', { name: 'Run simulation' })).toBeVisible();
});
