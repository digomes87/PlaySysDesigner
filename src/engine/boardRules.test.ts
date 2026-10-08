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
  test('aceita um tabuleiro bem formado', () => {
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

  test('origem do tráfego não pode repartir carga sozinha', () => {
    const board = makeBoard(
      [src, app1, app2],
      [
        ['src', 'app1'],
        ['src', 'app2'],
      ],
    );

    expect(validateBoard(board)).toEqual([{ code: 'source_multiple_outputs', nodeId: 'src' }]);
  });

  test('acusa tabuleiro sem origem de tráfego', () => {
    expect(codes(makeBoard([app1], []))).toEqual(['missing_source']);
  });

  test('acusa aresta para nó inexistente, laço, duplicata e aresta entrando na origem', () => {
    const board = makeBoard(
      [src, app1],
      [
        ['src', 'app1'],
        ['app1', 'fantasma'],
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
