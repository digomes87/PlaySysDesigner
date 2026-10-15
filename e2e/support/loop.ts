import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';

const LEVELS_DIR = new URL('../../public/content/levels/', import.meta.url);

/** Palette ids in the order the palette lists them. */
export function paletteOf(levelId: string): string[] {
  const level = JSON.parse(readFileSync(new URL(`${levelId}.json`, LEVELS_DIR), 'utf8')) as {
    availableComponents: { id: string }[];
  };
  return level.availableComponents.map((item) => item.id);
}

export async function openLevel(page: Page, levelId: string): Promise<void> {
  await page.goto(`./#/level/${levelId}`);
  await expect(page.locator('.stepper')).toBeVisible();
}

/** Picks the first option and moves on; these tests check the loop, not the answers. */
export async function answerAndContinue(page: Page, continueLabel: string | RegExp): Promise<void> {
  await page.locator('.question__option').first().click();
  await page.locator('.question__feedback').getByRole('button', { name: continueLabel }).click();
}

export type RunOutcome = 'passed' | 'failed';

export async function runToEnd(page: Page): Promise<RunOutcome> {
  await page.getByRole('button', { name: 'Run simulation' }).click();
  await page.getByRole('button', { name: /Skip to the end/ }).click();
  const outcome = page.locator('.dock--passed, .dock--failed');
  await expect(outcome).toBeVisible();
  return (await outcome.getAttribute('class'))?.includes('dock--passed') ? 'passed' : 'failed';
}

/** After a failed run: answer the diagnosis and go back to the board, which names the failed metric. */
export async function backToBuild(page: Page): Promise<string> {
  await answerAndContinue(page, /Adjust the architecture/);
  return (await page.locator('.buildbar__last').textContent()) ?? '';
}
