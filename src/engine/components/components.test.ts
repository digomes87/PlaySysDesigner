import { describe, expect, test } from 'vitest';
import { runToEnd } from '../simulation';
import { dropCount, edgeId, flowCount, makeBoard, makeConfig, makeMix, makeNode, runCollecting } from '../testing';
import type { SpecOverrides } from '../testing';
import { COMPONENT_TYPES, REQUEST_KINDS, type Board } from '../types';
import { BEHAVIORS } from './registry';

const FAST_APP: SpecOverrides = { capacityRps: 100_000 };

/** src -> app -> cache -> db, with writes going straight app -> db. */
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

/** src -> app -> replica (reads) and app -> primary (writes). */
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

/** src -> app -> queue -> worker -> primary. */
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
  test('every component type has a behaviour and a priority for every request type', () => {
    for (const type of COMPONENT_TYPES) {
      for (const kind of REQUEST_KINDS) {
        expect(BEHAVIORS[type].priority[kind]).toBeTypeOf('number');
      }
    }
  });
});

describe('cache', () => {
  test('only the miss fraction reaches the database', () => {
    const run = runCollecting(
      makeConfig(cachedBoard(0.8), { traffic: { baseRps: 200, mix: makeMix({ read: 1 }) }, durationSec: 20 }),
    );

    const missRatio = flowCount(run, edgeId('cache', 'db')) / flowCount(run, edgeId('app', 'cache'));

    expect(missRatio).toBeGreaterThan(0.17);
    expect(missRatio).toBeLessThan(0.23);
  });

  test('hitRate 1 without writes never queries the database', () => {
    const run = runCollecting(makeConfig(cachedBoard(1), { traffic: { baseRps: 200, mix: makeMix({ read: 1 }) } }));

    expect(flowCount(run, edgeId('cache', 'db'))).toBe(0);
  });

  test('a write invalidates the key: its next read is a miss', () => {
    const traffic = { baseRps: 200, mix: makeMix({ read: 0.5, write: 0.5 }), keyspace: 1 };

    const run = runCollecting(makeConfig(cachedBoard(1), { traffic }));

    expect(flowCount(run, edgeId('cache', 'db'), 'read')).toBeGreaterThan(0);
    expect(run.result.metrics.staleReads).toBe(0);
  });

  test('bots always miss the cache', () => {
    const run = runCollecting(makeConfig(cachedBoard(1), { traffic: { baseRps: 100, mix: makeMix({ bot: 1 }) } }));

    expect(flowCount(run, edgeId('cache', 'db'), 'bot')).toBe(1000);
  });

  test('relieves a saturated database', () => {
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

  test('a read within the lag window after a write counts as staleRead', () => {
    const result = runToEnd(makeConfig(replicatedBoard(500), { traffic }));

    expect(result.metrics.staleReads).toBeGreaterThan(0);
  });

  test('without lag there are no stale reads', () => {
    const result = runToEnd(makeConfig(replicatedBoard(0), { traffic }));

    expect(result.metrics.staleReads).toBe(0);
  });

  test('more lag produces more stale reads', () => {
    const sparse = { ...traffic, keyspace: 1000 };

    const short = runToEnd(makeConfig(replicatedBoard(200), { traffic: sparse }));
    const long = runToEnd(makeConfig(replicatedBoard(2000), { traffic: sparse }));

    expect(long.metrics.staleReads).toBeGreaterThan(short.metrics.staleReads * 2);
  });

  test('reading from the primary is never stale', () => {
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

  test('does not accept writes', () => {
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

  test('the queue absorbs the spike: the client gets a fast ack and no write is lost', () => {
    const board = queuedBoard({ queueSize: 100_000, workerRps: 90, primaryRps: 100 });

    const result = runToEnd(makeConfig(board, { traffic }));

    expect(result.metrics.lostWrites).toBe(0);
    expect(result.metrics.errorRate).toBe(0);
    expect(result.metrics.p99LatencyMs).toBeLessThan(50);
  });

  test('the worker delivers to the primary at its own capacity', () => {
    const board = queuedBoard({ queueSize: 100_000, workerRps: 90, primaryRps: 100 });

    const run = runCollecting(makeConfig(board, { traffic }));

    // The queue dispatches at the start of the tick: the first tick has nothing to deliver yet.
    const delivered = 90 * 10 - 9;
    expect(flowCount(run, edgeId('w', 'db'))).toBe(delivered);
    expect(run.snapshots.at(-1)?.nodes.q?.queued).toBe(5000 - delivered);
  });

  test('a full queue drops and loses writes', () => {
    const board = queuedBoard({ queueSize: 100, workerRps: 90, primaryRps: 100 });

    const result = runToEnd(makeConfig(board, { traffic }));

    expect(result.metrics.lostWrites).toBeGreaterThan(3000);
  });

  test('a worker faster than the primary loses already acknowledged writes', () => {
    const board = queuedBoard({ queueSize: 100_000, workerRps: 300, primaryRps: 100 });

    const result = runToEnd(makeConfig(board, { traffic }));

    expect(result.metrics.lostWrites).toBeGreaterThan(0);
    expect(result.metrics.errorRate).toBe(0);
  });

  test('a queue without a worker only accumulates', () => {
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

  test('drops bots and lets legitimate traffic through without errors', () => {
    const run = runCollecting(makeConfig(limitedBoard(0), { traffic }));

    expect(flowCount(run, edgeId('rl', 'app'), 'bot')).toBe(0);
    expect(flowCount(run, edgeId('rl', 'app'), 'read')).toBe(flowCount(run, edgeId('src', 'rl'), 'read'));
    expect(dropCount(run, 'rate_limited')).toBe(flowCount(run, edgeId('src', 'rl'), 'bot'));
    expect(run.result.metrics.errorRate).toBe(0);
  });

  test('lets bots through up to limitRps', () => {
    const run = runCollecting(makeConfig(limitedBoard(50), { traffic }));

    expect(flowCount(run, edgeId('rl', 'app'), 'bot')).toBe(500);
  });

  test('without a limiter, bots eat the app capacity and bring reads down', () => {
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
