import type { Page } from '@playwright/test';

const DB_NAME = 'playsysdesigner';
const HOUR_MS = 60 * 60 * 1000;

export interface CompletedLevel {
  readonly levelId: string;
  readonly hoursAgo: number;
}

/**
 * Marks levels as completed straight in IndexedDB, so a test can open a level
 * without replaying the ones before it. The app must have created the database
 * first; the page is reloaded so the progress store reads the new rows.
 */
export async function seedCompletedLevels(page: Page, levels: readonly CompletedLevel[]): Promise<void> {
  await page.goto('./');
  await page.getByRole('heading', { level: 1 }).first().waitFor();
  const rows = levels.map(({ levelId, hoursAgo }) => ({
    levelId,
    runs: 1,
    completedAt: new Date(Date.now() - hoursAgo * HOUR_MS).toISOString(),
  }));
  await page.evaluate(
    ({ name, rows }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const transaction = request.result.transaction('levels', 'readwrite');
          for (const row of rows) transaction.objectStore('levels').put(row);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
        };
      }),
    { name: DB_NAME, rows },
  );
  await page.reload();
}

/** The stored completion time of a level, or null when the app has not recorded it. */
export async function storedCompletion(page: Page, levelId: string): Promise<string | null> {
  return page.evaluate(
    ({ name, levelId }) =>
      new Promise<string | null>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const read = request.result.transaction('levels').objectStore('levels').get(levelId);
          read.onsuccess = () => resolve(read.result?.completedAt ?? null);
          read.onerror = () => reject(read.error);
        };
      }),
    { name: DB_NAME, levelId },
  );
}
