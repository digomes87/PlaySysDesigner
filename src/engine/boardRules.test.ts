import { describe, expect, test } from 'vitest';
import { validateBoard } from './boardRules';
import { makeBoard, makeNode } from './testing';

const src = makeNode('src', 'traffic_source');
const lb = makeNode('lb', 'load_balancer');
const app1 = makeNode('app1', 'app_server');
const app2 = makeNode('app2', 'app_server');

function codes(board: Parameters<typeof validateBoard>[0]): string[] {
  return validateBoard(board).map((issue) => issue.code);
}

describe('validateBoard', () => {
  test('accepts a well-formed board', () => {
    const board = makeBoard(
      [src, lb, app1, app2],
      [
        ['src', 'lb'],
        ['lb', 'app1'],
        ['lb', 'app2'],
      ],
    );

    expect(validateBoard(board)).toEqual([]);
  });

  test('the traffic source cannot spread load by itself', () => {
    const board = makeBoard(
      [src, app1, app2],
      [
        ['src', 'app1'],
        ['src', 'app2'],
      ],
    );

    expect(validateBoard(board)).toEqual([{ code: 'source_multiple_outputs', nodeId: 'src' }]);
  });

  test('flags a board without a traffic source', () => {
    expect(codes(makeBoard([app1], []))).toEqual(['missing_source']);
  });

  test('flags an edge to a missing node, a self-loop, a duplicate and an edge into the source', () => {
    const board = makeBoard(
      [src, app1],
      [
        ['src', 'app1'],
        ['app1', 'ghost'],
        ['app1', 'app1'],
        ['app1', 'src'],
        ['src', 'app1'],
      ],
    );

    expect(codes(board).sort()).toEqual(
      ['duplicate_edge', 'edge_into_source', 'self_loop', 'source_multiple_outputs', 'unknown_node'].sort(),
    );
  });
});
