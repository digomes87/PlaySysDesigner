import { describe, expect, test } from 'vitest';
import { runToEnd } from '../simulation';
import { dropCount, edgeId, flowCount, makeBoard, makeConfig, makeMix, makeNode, runCollecting } from '../testing';
import type { SpecOverrides } from '../testing';
import { COMPONENT_TYPES, REQUEST_KINDS, type Board } from '../types';
import { BEHAVIORS } from './registry';

const FAST_APP: SpecOverrides = { capacityRps: 100_000 };

/** src -> app -> cache -> db, com escrita indo direto app -> db. */
function cachedBoard(hitRate: number): Board {
  return makeBoard(
    [
      makeNode('src', 'traffic_source'),
      makeNode('app', 'app_server', FAST_APP),
      makeNode('cache', 'cache', { params: { hitRate } }),
      makeNode('db', 'db_primary'),
    ],
    [
      ['src', 'app'],
      ['app', 'cache'],
      ['app', 'db'],
      ['cache', 'db'],
    ],
  );
}

/** src -> app -> réplica (leitura) e app -> primário (escrita). */
function replicatedBoard(replicationLagMs: number): Board {
  return makeBoard(
    [
      makeNode('src', 'traffic_source'),
      makeNode('app', 'app_server', FAST_APP),
      makeNode('db', 'db_primary'),
      makeNode('replica', 'db_replica', { params: { replicationLagMs } }),
    ],
    [
      ['src', 'app'],
      ['app', 'db'],
      ['app', 'replica'],
    ],
  );
}

/** src -> app -> fila -> worker -> primário. */
function queuedBoard(options: { queueSize: number; workerRps: number; primaryRps: number }): Board {
  return makeBoard(
    [
      makeNode('src', 'traffic_source'),
      makeNode('app', 'app_server', FAST_APP),
      makeNode('q', 'queue', { bufferSize: options.queueSize }),
      makeNode('w', 'worker', { capacityRps: options.workerRps }),
      makeNode('db', 'db_primary', { capacityRps: options.primaryRps, bufferSize: 10 }),
    ],
    [
      ['src', 'app'],
      ['app', 'q'],
      ['q', 'w'],
      ['w', 'db'],
    ],
  );
}

describe('registry', () => {
  test('todo tipo de componente tem comportamento e prioridade para cada tipo de requisição', () => {
    for (const type of COMPONENT_TYPES) {
      for (const kind of REQUEST_KINDS) {
        expect(BEHAVIORS[type].priority[kind]).toBeTypeOf('number');
      }
    }
  });
});

describe('cache', () => {
  test('só a fração de misses chega ao banco', () => {
    const run = runCollecting(
      makeConfig(cachedBoard(0.8), { traffic: { baseRps: 200, mix: makeMix({ read: 1 }) }, durationSec: 20 }),
    );

    const missRatio = flowCount(run, edgeId('cache', 'db')) / flowCount(run, edgeId('app', 'cache'));

    expect(missRatio).toBeGreaterThan(0.17);
    expect(missRatio).toBeLessThan(0.23);
  });

  test('hitRate 1 sem escritas nunca consulta o banco', () => {
    const run = runCollecting(makeConfig(cachedBoard(1), { traffic: { baseRps: 200, mix: makeMix({ read: 1 }) } }));

    expect(flowCount(run, edgeId('cache', 'db'))).toBe(0);
  });

  test('escrita invalida a chave: a próxima leitura dela é miss', () => {
    const traffic = { baseRps: 200, mix: makeMix({ read: 0.5, write: 0.5 }), keyspace: 1 };

    const run = runCollecting(makeConfig(cachedBoard(1), { traffic }));

    expect(flowCount(run, edgeId('cache', 'db'), 'read')).toBeGreaterThan(0);
    expect(run.result.metrics.staleReads).toBe(0);
  });

  test('bot sempre fura o cache', () => {
    const run = runCollecting(makeConfig(cachedBoard(1), { traffic: { baseRps: 100, mix: makeMix({ bot: 1 }) } }));

    expect(flowCount(run, edgeId('cache', 'db'), 'bot')).toBe(1000);
  });

  test('alivia um banco saturado', () => {
    const slowDb = (board: Board): Board => ({
      ...board,
      nodes: board.nodes.map((node) => (node.id === 'db' ? makeNode('db', 'db_primary', { capacityRps: 300, bufferSize: 100 }) : node)),
    });
    const traffic = { baseRps: 1000, mix: makeMix({ read: 1 }) };

    const cold = runToEnd(makeConfig(slowDb(cachedBoard(0)), { traffic }));
    const warm = runToEnd(makeConfig(slowDb(cachedBoard(0.8)), { traffic }));

    expect(cold.metrics.errorRate).toBeGreaterThan(0.5);
    expect(warm.metrics.errorRate).toBe(0);
  });
});

describe('db_replica', () => {
  const traffic = { baseRps: 200, mix: makeMix({ read: 0.5, write: 0.5 }), keyspace: 10 };

  test('leitura dentro da janela de lag após escrita conta como staleRead', () => {
    const result = runToEnd(makeConfig(replicatedBoard(500), { traffic }));

    expect(result.metrics.staleReads).toBeGreaterThan(0);
  });

  test('sem lag não há leitura velha', () => {
    const result = runToEnd(makeConfig(replicatedBoard(0), { traffic }));

    expect(result.metrics.staleReads).toBe(0);
  });

  test('lag maior gera mais leituras velhas', () => {
    const sparse = { ...traffic, keyspace: 1000 };

    const short = runToEnd(makeConfig(replicatedBoard(200), { traffic: sparse }));
    const long = runToEnd(makeConfig(replicatedBoard(2000), { traffic: sparse }));

    expect(long.metrics.staleReads).toBeGreaterThan(short.metrics.staleReads * 2);
  });

  test('ler do primário nunca é velho', () => {
    const board = makeBoard(
      [makeNode('src', 'traffic_source'), makeNode('app', 'app_server', FAST_APP), makeNode('db', 'db_primary')],
      [
        ['src', 'app'],
        ['app', 'db'],
      ],
    );

    const result = runToEnd(makeConfig(board, { traffic }));

    expect(result.metrics.staleReads).toBe(0);
  });

  test('não aceita escrita', () => {
    const board = makeBoard(
      [
        makeNode('src', 'traffic_source'),
        makeNode('app', 'app_server', FAST_APP),
        makeNode('replica', 'db_replica'),
      ],
      [
        ['src', 'app'],
        ['app', 'replica'],
      ],
    );

    const run = runCollecting(makeConfig(board, { traffic: { baseRps: 100, mix: makeMix({ write: 1 }) } }));

    expect(flowCount(run, edgeId('app', 'replica'))).toBe(0);
    expect(dropCount(run, 'no_route')).toBe(1000);
  });
});

describe('queue + worker', () => {
  const traffic = { baseRps: 500, mix: makeMix({ write: 1 }) };

  test('fila absorve o pico: cliente recebe ack rápido e nenhuma escrita se perde', () => {
    const board = queuedBoard({ queueSize: 100_000, workerRps: 90, primaryRps: 100 });

    const result = runToEnd(makeConfig(board, { traffic }));

    expect(result.metrics.lostWrites).toBe(0);
    expect(result.metrics.errorRate).toBe(0);
    expect(result.metrics.p99LatencyMs).toBeLessThan(50);
  });

  test('worker entrega ao primário no ritmo da própria capacidade', () => {
    const board = queuedBoard({ queueSize: 100_000, workerRps: 90, primaryRps: 100 });

    const run = runCollecting(makeConfig(board, { traffic }));

    // A fila despacha no começo do tick: o primeiro tick ainda não tem o que entregar.
    const delivered = 90 * 10 - 9;
    expect(flowCount(run, edgeId('w', 'db'))).toBe(delivered);
    expect(run.snapshots.at(-1)?.nodes.q?.queued).toBe(5000 - delivered);
  });

  test('fila cheia descarta e perde escrita', () => {
    const board = queuedBoard({ queueSize: 100, workerRps: 90, primaryRps: 100 });

    const result = runToEnd(makeConfig(board, { traffic }));

    expect(result.metrics.lostWrites).toBeGreaterThan(3000);
  });

  test('worker mais rápido que o primário perde escrita já confirmada', () => {
    const board = queuedBoard({ queueSize: 100_000, workerRps: 300, primaryRps: 100 });

    const result = runToEnd(makeConfig(board, { traffic }));

    expect(result.metrics.lostWrites).toBeGreaterThan(0);
    expect(result.metrics.errorRate).toBe(0);
  });

  test('fila sem worker só acumula', () => {
    const board = makeBoard(
      [makeNode('src', 'traffic_source'), makeNode('app', 'app_server', FAST_APP), makeNode('q', 'queue')],
      [
        ['src', 'app'],
        ['app', 'q'],
      ],
    );

    const run = runCollecting(makeConfig(board, { traffic }));

    expect(run.snapshots.at(-1)?.nodes.q?.queued).toBe(5000);
    expect(run.result.metrics.lostWrites).toBe(0);
  });
});

describe('rate_limiter', () => {
  function limitedBoard(limitRps: number): Board {
    return makeBoard(
      [
        makeNode('src', 'traffic_source'),
        makeNode('rl', 'rate_limiter', { params: { limitRps } }),
        makeNode('app', 'app_server', FAST_APP),
        makeNode('db', 'db_primary'),
      ],
      [
        ['src', 'rl'],
        ['rl', 'app'],
        ['app', 'db'],
      ],
    );
  }
  const traffic = { baseRps: 400, mix: makeMix({ read: 0.5, bot: 0.5 }) };

  test('descarta bots e deixa o tráfego legítimo passar sem erro', () => {
    const run = runCollecting(makeConfig(limitedBoard(0), { traffic }));

    expect(flowCount(run, edgeId('rl', 'app'), 'bot')).toBe(0);
    expect(flowCount(run, edgeId('rl', 'app'), 'read')).toBe(flowCount(run, edgeId('src', 'rl'), 'read'));
    expect(dropCount(run, 'rate_limited')).toBe(flowCount(run, edgeId('src', 'rl'), 'bot'));
    expect(run.result.metrics.errorRate).toBe(0);
  });

  test('deixa passar bots até limitRps', () => {
    const run = runCollecting(makeConfig(limitedBoard(50), { traffic }));

    expect(flowCount(run, edgeId('rl', 'app'), 'bot')).toBe(500);
  });

  test('sem limiter, bots consomem a capacidade do app e derrubam leituras', () => {
    const board = makeBoard(
      [makeNode('src', 'traffic_source'), makeNode('app', 'app_server', { capacityRps: 250 }), makeNode('db', 'db_primary')],
      [
        ['src', 'app'],
        ['app', 'db'],
      ],
    );

    const result = runToEnd(makeConfig(board, { traffic }));

    expect(result.metrics.errorRate).toBeGreaterThan(0.2);
  });
});
