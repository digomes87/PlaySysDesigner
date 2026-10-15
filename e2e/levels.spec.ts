import { expect, test, type Page } from '@playwright/test';
import { build, type BuildPlan } from './support/board';
import { answerAndContinue, backToBuild, openLevel, paletteOf, runToEnd } from './support/loop';
import { seedCompletedLevels, storedCompletion } from './support/progress';

interface LevelPlay {
  readonly levelId: string;
  readonly completedBefore: readonly string[];
  /** A tempting shortcut and the metric it fails on first, which picks the diagnosis. */
  readonly trap: BuildPlan;
  readonly trapFailsOn: string;
  /** What turns the trap into the reference solution. */
  readonly fix: BuildPlan;
}

const APPS_L4 = ['app-1', 'app-server-1', 'app-server-2', 'app-server-3'];

const PLAYS: readonly LevelPlay[] = [
  {
    levelId: 'level-02',
    completedBefore: ['level-01'],
    trap: { add: ['cache'], connect: [['app-1', 'cache-1'], ['app-2', 'cache-1'], ['cache-1', 'db']] },
    trapFailsOn: 'p99 latency',
    fix: {
      add: ['replica-near', 'replica-near'],
      removeEdges: ['cache-1->db'],
      connect: [['cache-1', 'replica-near-1'], ['cache-1', 'replica-near-2']],
    },
  },
  {
    levelId: 'level-03',
    completedBefore: ['level-01', 'level-02'],
    trap: {
      add: ['queue', 'worker', 'worker'],
      connect: [
        ['app-1', 'queue-1'],
        ['app-2', 'queue-1'],
        ['queue-1', 'worker-1'],
        ['queue-1', 'worker-2'],
        ['worker-1', 'db'],
        ['worker-2', 'db'],
      ],
    },
    trapFailsOn: 'Error rate',
    fix: { add: ['rate-limiter'], removeEdges: ['src->lb'], connect: [['src', 'rate-limiter-1'], ['rate-limiter-1', 'lb']] },
  },
  {
    levelId: 'level-04',
    completedBefore: ['level-01', 'level-02', 'level-03'],
    trap: {
      add: ['load-balancer', 'app-server', 'app-server', 'app-server', 'cache', 'replica-near', 'replica-near', 'queue', 'worker'],
      removeEdges: ['src->app-1'],
      connect: [
        ['src', 'load-balancer-1'],
        ...APPS_L4.map((app) => ['load-balancer-1', app] as const),
        ...APPS_L4.map((app) => [app, 'cache-1'] as const),
        ['cache-1', 'replica-near-1'],
        ['cache-1', 'replica-near-2'],
        ...APPS_L4.map((app) => [app, 'queue-1'] as const),
        ['queue-1', 'worker-1'],
        ['worker-1', 'db'],
      ],
    },
    trapFailsOn: 'p99 latency',
    fix: {
      add: ['rate-limiter'],
      removeEdges: ['src->load-balancer-1'],
      connect: [['src', 'rate-limiter-1'], ['rate-limiter-1', 'load-balancer-1']],
    },
  },
];

const HOURS_AGO_ENOUGH_FOR_REVIEW = 25;

async function seedPrerequisites(page: Page, levelIds: readonly string[]): Promise<void> {
  await seedCompletedLevels(
    page,
    levelIds.map((levelId) => ({ levelId, hoursAgo: HOURS_AGO_ENOUGH_FOR_REVIEW })),
  );
}

for (const play of PLAYS) {
  test(`${play.levelId}: the shortcut fails, the fix passes and the level completes`, async ({ page }) => {
    const palette = paletteOf(play.levelId);
    await seedPrerequisites(page, play.completedBefore);
    await openLevel(page, play.levelId);

    await answerAndContinue(page, 'Go to the board');
    await build(page, play.trap, palette);
    expect(await runToEnd(page)).toBe('failed');
    expect(await backToBuild(page)).toContain(play.trapFailsOn);

    await build(page, play.fix, palette);
    expect(await runToEnd(page)).toBe('passed');
    await answerAndContinue(page, 'Complete level');

    await expect(page.locator('.complete')).toBeVisible();
    await expect.poll(() => storedCompletion(page, play.levelId)).not.toBeNull();
  });
}

test('level-04 stays locked until 24 hours after level-03', async ({ page }) => {
  await seedCompletedLevels(page, [
    { levelId: 'level-01', hoursAgo: 48 },
    { levelId: 'level-02', hoursAgo: 48 },
    { levelId: 'level-03', hoursAgo: 1 },
  ]);
  await page.goto('./#/level/level-04');
  await expect(page.getByText('This level is still locked.')).toBeVisible();
});
