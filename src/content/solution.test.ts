import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { levelSchema } from './schema';
import { applySolution } from './solution';

const level = levelSchema.parse(
  JSON.parse(readFileSync(join(process.cwd(), 'public', 'content', 'levels', 'level-01.json'), 'utf8')),
);

describe('applySolution', () => {
  test('adds the solution components where the content places them, tagged with their palette id', () => {
    const board = applySolution(level);

    const balancer = board.nodes.find((node) => node.id === 'load-balancer-1');
    expect(balancer).toMatchObject({ type: 'load_balancer', paletteId: 'load-balancer', position: { x: 200, y: 200 } });
  });

  test('keeps the initial system and swaps the edges the solution replaces', () => {
    const board = applySolution(level);
    const edgeIds = board.edges.map((edge) => edge.id);

    expect(board.nodes.map((node) => node.id)).toEqual(expect.arrayContaining(['src', 'app-1', 'db']));
    expect(edgeIds).not.toContain('src->app-1');
    expect(edgeIds).toEqual(expect.arrayContaining(['src->load-balancer-1', 'load-balancer-1->app-1']));
  });

  test('rejects a solution that uses a component missing from the palette', () => {
    const broken = { ...level, solution: { ...level.solution, add: [{ paletteId: 'ghost', nodeId: 'ghost-1', position: { x: 0, y: 0 } }] } };

    expect(levelSchema.safeParse(broken).success).toBe(false);
  });
});
