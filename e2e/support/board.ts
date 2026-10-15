import { expect, type Locator, type Page } from '@playwright/test';

export type Link = readonly [string, string];

/** What a player does on the board in one build step, by node id. */
export interface BuildPlan {
  /** Palette ids, clicked in order; the app names them `<paletteId>-<n>`. */
  readonly add?: readonly string[];
  readonly removeEdges?: readonly string[];
  readonly connect?: readonly Link[];
}

const DRAG_STEPS = 8;

function node(page: Page, nodeId: string): Locator {
  return page.locator(`.react-flow__node[data-id="${nodeId}"]`);
}

async function centerOf(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Element is not visible.');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function addFromPalette(page: Page, paletteId: string, paletteIds: readonly string[]): Promise<void> {
  const before = await page.locator('.react-flow__node').count();
  await page.locator('.palette__item').nth(paletteIds.indexOf(paletteId)).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(before + 1);
}

export async function connect(page: Page, [from, to]: Link): Promise<void> {
  const edge = page.getByTestId(`rf__edge-${from}->${to}`);
  const start = await centerOf(node(page, from).locator('.react-flow__handle.source'));
  const end = await centerOf(node(page, to).locator('.react-flow__handle.target'));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: DRAG_STEPS });
  await page.mouse.up();
  await expect(edge, `edge ${from}->${to}`).toHaveCount(1);
}

export async function removeEdge(page: Page, edgeId: string): Promise<void> {
  const edge = page.getByTestId(`rf__edge-${edgeId}`);
  // Keyboard path: focus the edge, select it, delete it.
  await edge.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Delete');
  await expect(edge).toHaveCount(0);
}

/** The board refits a moment after a component is added; wait until the viewport stops moving. */
async function waitForSteadyViewport(page: Page): Promise<void> {
  const viewport = page.locator('.react-flow__viewport');
  let previous = '';
  await expect
    .poll(async () => {
      const current = (await viewport.getAttribute('style')) ?? '';
      const steady = current === previous;
      previous = current;
      return steady;
    })
    .toBe(true);
}

export async function build(page: Page, plan: BuildPlan, paletteIds: readonly string[]): Promise<void> {
  for (const paletteId of plan.add ?? []) await addFromPalette(page, paletteId, paletteIds);
  await waitForSteadyViewport(page);
  for (const edgeId of plan.removeEdges ?? []) await removeEdge(page, edgeId);
  for (const link of plan.connect ?? []) await connect(page, link);
}
