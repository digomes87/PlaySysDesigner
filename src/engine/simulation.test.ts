import { describe, expect, test } from 'vitest';
import { createSimulation, runToEnd } from './simulation';
import { edgeId, flowCount, makeBoard, makeConfig, makeEvent, makeMix, makeNode, runCollecting } from './testing';
import { TICKS_PER_SEC, type Board } from './types';

/** src -> app -> db, with the app as the bottleneck. */
function singleServerBoard(appOverrides: Parameters<typeof makeNode>[2] = {}): Board {
  return makeBoard(
    [makeNode('src', 'traffic_source'), makeNode('app', 'app_server', appOverrides), makeNode('db', 'db_primary')],
    [
      ['src', 'app'],
      ['app', 'db'],
    ],
  );
}

/** src -> lb -> N app servers -> db. */
function balancedBoard(serverCount: number): Board {
  const servers = Array.from({ length: serverCount }, (_, index) => makeNode(`app${index + 1}`, 'app_server'));
  return makeBoard(
    [makeNode('src', 'traffic_source'), makeNode('lb', 'load_balancer'), ...servers, makeNode('db', 'db_primary')],
    [['src', 'lb'], ...servers.flatMap((server) => [['lb', server.id], [server.id, 'db']] as const)],
  );
}

describe('determinism', () => {
  const board = makeBoard(
    [
      makeNode('src', 'traffic_source'),
      makeNode('app', 'app_server', { capacityRps: 300, bufferSize: 20 }),
      makeNode('cache', 'cache'),
      makeNode('db', 'db_primary'),
    ],
    [
      ['src', 'app'],
      ['app', 'cache'],
      ['app', 'db'],
      ['cache', 'db'],
    ],
  );
  const config = makeConfig(board, {
    traffic: { baseRps: 250, mix: makeMix({ read: 0.7, write: 0.2, bot: 0.1 }) },
    events: [makeEvent(3, 'traffic_spike', { multiplier: 3, durationSec: 2 })],
  });

  test('same seed and same board give the same run, tick by tick', () => {
    const first = runCollecting(config);
    const second = runCollecting(config);

    expect(second).toEqual(first);
  });

  test('seed diferente muda a partida', () => {
    const first = runCollecting(config);
    const second = runCollecting({ ...config, seed: config.seed + 1 });

    expect(second.snapshots).not.toEqual(first.snapshots);
  });

  test('runToEnd gives the same result as stepping through', () => {
    expect(runToEnd(config)).toEqual(runCollecting(config).result);
  });
});

describe('lifecycle', () => {
  test('runs durationSec * 10 ticks and then finishes', () => {
    const simulation = createSimulation(makeConfig(singleServerBoard(), { durationSec: 3 }));

    let ticks = 0;
    while (!simulation.isFinished()) {
      simulation.step();
      ticks += 1;
    }

    expect(ticks).toBe(3 * TICKS_PER_SEC);
    expect(() => simulation.step()).toThrow();
  });

  test('rejects a board without a traffic source', () => {
    const board = makeBoard([makeNode('app', 'app_server')], []);

    expect(() => createSimulation(makeConfig(board))).toThrow(/traffic_source/);
  });

  test('rejects an edge pointing to a missing node', () => {
    const board = makeBoard([makeNode('src', 'traffic_source')], [['src', 'ghost']]);

    expect(() => createSimulation(makeConfig(board))).toThrow(/ghost/);
  });

  test('drops with no_route when the request has nowhere to go', () => {
    const board = makeBoard([makeNode('src', 'traffic_source'), makeNode('app', 'app_server')], [['src', 'app']]);

    const result = runToEnd(makeConfig(board));

    expect(result.metrics.errorRate).toBe(1);
  });
});

describe('saturation', () => {
  test('latency follows base / (1 - utilization)', () => {
    const board = makeBoard(
      [
        makeNode('src', 'traffic_source'),
        makeNode('app', 'app_server', { capacityRps: 500, baseLatencyMs: 12 }),
        makeNode('db', 'db_primary', { baseLatencyMs: 0 }),
      ],
      [
        ['src', 'app'],
        ['app', 'db'],
      ],
    );

    const result = runToEnd(makeConfig(board, { traffic: { baseRps: 250, mix: makeMix({ read: 1 }) } }));

    expect(result.metrics.p99LatencyMs).toBe(24);
    expect(result.metrics.errorRate).toBe(0);
  });

  test('latency hits the ceiling when utilization reaches 1', () => {
    const board = singleServerBoard({ capacityRps: 500, baseLatencyMs: 10, bufferSize: 1000 });

    const result = runToEnd(makeConfig(board, { traffic: { baseRps: 500, mix: makeMix({ read: 1 }) } }));

    expect(result.metrics.p99LatencyMs).toBeGreaterThanOrEqual(200);
    expect(result.metrics.errorRate).toBe(0);
  });

  test('above capacity it queues up to bufferSize and drops the rest', () => {
    const board = singleServerBoard({ capacityRps: 500, bufferSize: 50 });

    const run = runCollecting(makeConfig(board, { traffic: { baseRps: 1000, mix: makeMix({ read: 1 }) } }));

    expect(run.result.metrics.errorRate).toBeGreaterThan(0.45);
    expect(run.result.metrics.errorRate).toBeLessThan(0.55);
    expect(run.snapshots.at(-1)?.nodes.app?.queued).toBe(50);
    expect(run.snapshots.at(-1)?.drops).toContainEqual({ nodeId: 'app', reason: 'saturated', count: 50 });
  });

  test('the buffer absorbs a short spike without errors, at the cost of latency', () => {
    const board = singleServerBoard({ capacityRps: 500, bufferSize: 2000 });
    const config = makeConfig(board, {
      traffic: { baseRps: 300, mix: makeMix({ read: 1 }) },
      events: [makeEvent(2, 'traffic_spike', { multiplier: 3, durationSec: 1 })],
    });

    const result = runToEnd(config);

    expect(result.metrics.errorRate).toBe(0);
    expect(result.metrics.p99LatencyMs).toBeGreaterThan(500);
  });

  test('a write dropped by saturation counts as lostWrites', () => {
    const board = singleServerBoard({ capacityRps: 100, bufferSize: 10 });

    const result = runToEnd(makeConfig(board, { traffic: { baseRps: 500, mix: makeMix({ write: 1 }) } }));

    expect(result.metrics.lostWrites).toBeGreaterThan(3000);
  });
});

describe('routing', () => {
  test('the load balancer rotates evenly across app servers', () => {
    const run = runCollecting(makeConfig(balancedBoard(4), { traffic: { baseRps: 400, mix: makeMix({ read: 1 }) } }));

    const perServer = [1, 2, 3, 4].map((index) => flowCount(run, edgeId('lb', `app${index}`)));

    expect(perServer).toEqual([1000, 1000, 1000, 1000]);
  });

  test('scaling out behind the load balancer removes the errors', () => {
    const traffic = { baseRps: 2000, mix: makeMix({ read: 1 }) };

    const alone = runToEnd(makeConfig(balancedBoard(1), { traffic }));
    const scaled = runToEnd(makeConfig(balancedBoard(5), { traffic }));

    expect(alone.metrics.errorRate).toBeGreaterThan(0.7);
    expect(scaled.metrics.errorRate).toBe(0);
  });

  test('reads prefer the cache over the primary; writes go straight to the primary', () => {
    const board = makeBoard(
      [
        makeNode('src', 'traffic_source'),
        makeNode('app', 'app_server', { capacityRps: 10_000 }),
        makeNode('cache', 'cache'),
        makeNode('db', 'db_primary'),
      ],
      [
        ['src', 'app'],
        ['app', 'db'],
        ['app', 'cache'],
        ['cache', 'db'],
      ],
    );

    const run = runCollecting(makeConfig(board, { traffic: { baseRps: 200, mix: makeMix({ read: 0.5, write: 0.5 }) } }));

    expect(flowCount(run, edgeId('app', 'db'), 'read')).toBe(0);
    expect(flowCount(run, edgeId('app', 'cache'), 'write')).toBe(0);
    expect(flowCount(run, edgeId('app', 'cache'), 'read')).toBeGreaterThan(0);
    expect(flowCount(run, edgeId('app', 'db'), 'write')).toBeGreaterThan(0);
  });

  test('reads prefer a replica over the primary and rotate between replicas', () => {
    const board = makeBoard(
      [
        makeNode('src', 'traffic_source'),
        makeNode('app', 'app_server', { capacityRps: 10_000 }),
        makeNode('db', 'db_primary'),
        makeNode('r1', 'db_replica'),
        makeNode('r2', 'db_replica'),
      ],
      [
        ['src', 'app'],
        ['app', 'db'],
        ['app', 'r1'],
        ['app', 'r2'],
      ],
    );

    const run = runCollecting(makeConfig(board, { traffic: { baseRps: 200, mix: makeMix({ read: 1 }) } }));

    expect(flowCount(run, edgeId('app', 'db'))).toBe(0);
    expect(flowCount(run, edgeId('app', 'r1'))).toBe(1000);
    expect(flowCount(run, edgeId('app', 'r2'))).toBe(1000);
  });

  test('writes prefer the queue over the primary', () => {
    const board = makeBoard(
      [
        makeNode('src', 'traffic_source'),
        makeNode('app', 'app_server', { capacityRps: 10_000 }),
        makeNode('q', 'queue'),
        makeNode('w', 'worker'),
        makeNode('db', 'db_primary'),
      ],
      [
        ['src', 'app'],
        ['app', 'db'],
        ['app', 'q'],
        ['q', 'w'],
        ['w', 'db'],
      ],
    );

    const run = runCollecting(makeConfig(board, { traffic: { baseRps: 50, mix: makeMix({ write: 1 }) } }));

    expect(flowCount(run, edgeId('app', 'db'))).toBe(0);
    expect(flowCount(run, edgeId('app', 'q'))).toBe(500);
  });

  test('a cycle on the board does not hang the simulation', () => {
    const board = makeBoard(
      [makeNode('src', 'traffic_source'), makeNode('lb1', 'load_balancer'), makeNode('lb2', 'load_balancer')],
      [
        ['src', 'lb1'],
        ['lb1', 'lb2'],
        ['lb2', 'lb1'],
      ],
    );

    const result = runToEnd(makeConfig(board, { durationSec: 1 }));

    expect(result.metrics.errorRate).toBe(1);
  });
});

describe('SLOs', () => {
  const slos = [
    { metric: 'errorRate', op: 'lte', value: 0.01 },
    { metric: 'p99LatencyMs', op: 'lte', value: 100 },
  ] as const;
  const ramp = makeEvent(0, 'traffic_ramp', { toRps: 2000, durationSec: 10 });
  const traffic = { baseRps: 200, mix: makeMix({ read: 1 }) };

  test('fails and reports the first violation when one server cannot take the ramp', () => {
    const result = runToEnd(makeConfig(balancedBoard(1), { traffic, events: [ramp], slos, durationSec: 20 }));

    expect(result.passed).toBe(false);
    expect(result.firstViolation).not.toBeNull();
    expect(result.firstViolation?.atSec).toBeGreaterThan(0);
    expect(result.firstViolation?.atSec).toBeLessThan(10);
    expect(result.violations.map((violation) => violation.metric).sort()).toEqual(['errorRate', 'p99LatencyMs']);
  });

  test('passes when the architecture meets every SLO for the whole run', () => {
    const result = runToEnd(makeConfig(balancedBoard(5), { traffic, events: [ramp], slos, durationSec: 20 }));

    expect(result.passed).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.firstViolation).toBeNull();
  });

  test('board cost becomes a metric and can violate an SLO', () => {
    const config = makeConfig(balancedBoard(5), {
      traffic,
      slos: [{ metric: 'costTier', op: 'lte', value: 'low' }],
      costBudget: { low: 3, mid: 6 },
    });

    const result = runToEnd(config);

    expect(result.metrics.costTier).toBe('high');
    expect(result.firstViolation).toEqual({ metric: 'costTier', atSec: 0, observed: 'high' });
  });
});
