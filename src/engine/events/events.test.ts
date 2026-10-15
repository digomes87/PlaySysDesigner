import { describe, expect, test } from 'vitest';
import { runToEnd } from '../simulation';
import {
  dropCount,
  edgeId,
  flowCount,
  makeBoard,
  makeConfig,
  makeEvent,
  makeMix,
  makeNode,
  runCollecting,
} from '../testing';
import { SIM_EVENT_TYPES, type Board } from '../types';
import { EVENT_HANDLERS } from './registry';

const READS = { baseRps: 200, mix: makeMix({ read: 1 }) };
const WRITES = { baseRps: 100, mix: makeMix({ write: 1 }) };

function simpleBoard(): Board {
  return makeBoard(
    [
      makeNode('src', 'traffic_source'),
      makeNode('app', 'app_server', { capacityRps: 100_000 }),
      makeNode('db', 'db_primary'),
    ],
    [
      ['src', 'app'],
      ['app', 'db'],
    ],
  );
}

function redundantBoard(): Board {
  return makeBoard(
    [
      makeNode('src', 'traffic_source'),
      makeNode('lb', 'load_balancer'),
      makeNode('app1', 'app_server'),
      makeNode('app2', 'app_server'),
      makeNode('db', 'db_primary'),
    ],
    [
      ['src', 'lb'],
      ['lb', 'app1'],
      ['lb', 'app2'],
      ['app1', 'db'],
      ['app2', 'db'],
    ],
  );
}

describe('registry', () => {
  test('every event type has a handler', () => {
    for (const type of SIM_EVENT_TYPES) {
      expect(EVENT_HANDLERS[type]).toBeTypeOf('function');
    }
  });

  test('an event shows up in firedEvents on the tick it fires, only once', () => {
    const event = makeEvent(2, 'traffic_spike', { multiplier: 2, durationSec: 1 });

    const run = runCollecting(makeConfig(simpleBoard(), { events: [event] }));

    const firedAt = run.snapshots.filter((snapshot) => snapshot.firedEvents.length > 0).map((snapshot) => snapshot.timeSec);
    expect(firedAt).toEqual([2]);
  });

  test('a missing required param fails with a clear message', () => {
    const config = makeConfig(simpleBoard(), { events: [makeEvent(0, 'traffic_ramp', {})] });

    expect(() => runToEnd(config)).toThrow(/toRps/);
  });
});

describe('traffic_ramp', () => {
  test('moves traffic linearly from baseRps to toRps', () => {
    const config = makeConfig(simpleBoard(), {
      traffic: READS,
      events: [makeEvent(0, 'traffic_ramp', { toRps: 2000, durationSec: 10 })],
      durationSec: 20,
    });

    const run = runCollecting(config);

    const srcToApp = edgeId('src', 'app');
    expect(flowCount(run, srcToApp, undefined, { fromSec: 0, toSec: 1 })).toBeLessThan(400);
    expect(flowCount(run, srcToApp, undefined, { fromSec: 5, toSec: 6 })).toBeGreaterThan(1000);
    expect(flowCount(run, srcToApp, undefined, { fromSec: 5, toSec: 6 })).toBeLessThan(1300);
    expect(flowCount(run, srcToApp, undefined, { fromSec: 15, toSec: 16 })).toBe(2000);
  });
});

describe('traffic_spike', () => {
  test('multiplies traffic only during the window', () => {
    const config = makeConfig(simpleBoard(), {
      traffic: READS,
      events: [makeEvent(4, 'traffic_spike', { multiplier: 10, durationSec: 2 })],
    });

    const run = runCollecting(config);

    const srcToApp = edgeId('src', 'app');
    expect(flowCount(run, srcToApp, undefined, { fromSec: 3, toSec: 4 })).toBe(200);
    expect(flowCount(run, srcToApp, undefined, { fromSec: 4, toSec: 6 })).toBe(4000);
    expect(flowCount(run, srcToApp, undefined, { fromSec: 6, toSec: 7 })).toBe(200);
  });
});

describe('bot_wave', () => {
  test('adds bot traffic during the window without touching legitimate traffic', () => {
    const config = makeConfig(simpleBoard(), {
      traffic: READS,
      events: [makeEvent(4, 'bot_wave', { rps: 500, durationSec: 2 })],
    });

    const run = runCollecting(config);

    const srcToApp = edgeId('src', 'app');
    expect(flowCount(run, srcToApp, 'bot', { toSec: 4 })).toBe(0);
    expect(flowCount(run, srcToApp, 'bot', { fromSec: 4, toSec: 6 })).toBe(1000);
    expect(flowCount(run, srcToApp, 'bot', { fromSec: 6 })).toBe(0);
    expect(flowCount(run, srcToApp, 'read')).toBe(2000);
  });
});

describe('node_failure', () => {
  const failure = makeEvent(4, 'node_failure', { nodeType: 'app_server', durationSec: 2 });

  test('a single node down takes everything down until it returns', () => {
    const run = runCollecting(makeConfig(simpleBoard(), { traffic: READS, events: [failure] }));

    expect(dropCount(run, 'node_down', { toSec: 4 })).toBe(0);
    expect(dropCount(run, 'node_down', { fromSec: 4, toSec: 6 })).toBe(400);
    expect(dropCount(run, 'node_down', { fromSec: 6 })).toBe(0);
    expect(run.snapshots.find((snapshot) => snapshot.timeSec === 5)?.nodes.app?.down).toBe(true);
    expect(run.result.metrics.availability).toBe(0.8);
  });

  test('with redundancy behind the load balancer the failure causes no errors', () => {
    const run = runCollecting(makeConfig(redundantBoard(), { traffic: READS, events: [failure] }));

    expect(run.result.metrics.errorRate).toBe(0);
    expect(flowCount(run, edgeId('lb', 'app1'), undefined, { fromSec: 4, toSec: 6 })).toBe(0);
    expect(flowCount(run, edgeId('lb', 'app2'), undefined, { fromSec: 4, toSec: 6 })).toBe(400);
  });

  test('accepts a target by nodeId and, without durationSec, the failure is permanent', () => {
    const event = makeEvent(4, 'node_failure', { nodeId: 'db' });

    const run = runCollecting(makeConfig(simpleBoard(), { traffic: READS, events: [event] }));

    expect(dropCount(run, 'node_down', { fromSec: 4 })).toBe(1200);
  });

  test('requests in the buffer of a failing node are lost', () => {
    const board = makeBoard(
      [
        makeNode('src', 'traffic_source'),
        makeNode('app', 'app_server', { capacityRps: 100, bufferSize: 500 }),
        makeNode('db', 'db_primary'),
      ],
      [
        ['src', 'app'],
        ['app', 'db'],
      ],
    );
    const event = makeEvent(2, 'node_failure', { nodeId: 'app', durationSec: 1 });

    const run = runCollecting(makeConfig(board, { traffic: READS, events: [event], durationSec: 4 }));

    const failureTick = run.snapshots.find((snapshot) => snapshot.timeSec === 2);
    expect(failureTick?.drops).toContainEqual({ nodeId: 'app', reason: 'node_down', count: 200 });
  });
});

describe('network_partition', () => {
  test('cuts the link between two nodes during the window', () => {
    const event = makeEvent(4, 'network_partition', { fromId: 'app', toId: 'db', durationSec: 2 });

    const run = runCollecting(makeConfig(simpleBoard(), { traffic: READS, events: [event] }));

    expect(dropCount(run, 'partitioned', { fromSec: 4, toSec: 6 })).toBe(400);
    expect(dropCount(run, 'partitioned', { fromSec: 6 })).toBe(0);
    expect(flowCount(run, edgeId('app', 'db'), undefined, { fromSec: 4, toSec: 6 })).toBe(0);
  });
});

describe('client_retry', () => {
  function slowPrimaryBoard(): Board {
    return makeBoard(
      [
        makeNode('src', 'traffic_source'),
        makeNode('app', 'app_server', { capacityRps: 100_000 }),
        makeNode('db', 'db_primary', { capacityRps: 100, baseLatencyMs: 50, bufferSize: 1000 }),
      ],
      [
        ['src', 'app'],
        ['app', 'db'],
      ],
    );
  }
  const traffic = { baseRps: 90, mix: makeMix({ write: 1 }) };

  test('retrying a slow write that was already stored produces duplicateOps', () => {
    const event = makeEvent(0, 'client_retry', { timeoutMs: 200, maxRetries: 1 });

    const result = runToEnd(makeConfig(slowPrimaryBoard(), { traffic, events: [event] }));

    expect(result.metrics.duplicateOps).toBeGreaterThan(0);
  });

  test('without retries there are no duplicates', () => {
    const result = runToEnd(makeConfig(slowPrimaryBoard(), { traffic }));

    expect(result.metrics.duplicateOps).toBe(0);
  });

  test('retry amplifica a carga sobre o sistema', () => {
    const event = makeEvent(0, 'client_retry', { timeoutMs: 200, maxRetries: 3 });

    const calm = runCollecting(makeConfig(slowPrimaryBoard(), { traffic }));
    const storm = runCollecting(makeConfig(slowPrimaryBoard(), { traffic, events: [event] }));

    const srcToApp = edgeId('src', 'app');
    expect(flowCount(storm, srcToApp)).toBeGreaterThan(flowCount(calm, srcToApp) * 1.5);
  });

  test('a dropped write that a retry manages to store does not count as lost', () => {
    const event = makeEvent(0, 'client_retry', { timeoutMs: 10_000, maxRetries: 5 });
    const outage = makeEvent(2, 'node_failure', { nodeId: 'db', durationSec: 0.2 });
    const board = simpleBoard();

    const withRetry = runToEnd(makeConfig(board, { traffic: WRITES, events: [event, outage] }));
    const withoutRetry = runToEnd(makeConfig(board, { traffic: WRITES, events: [outage] }));

    expect(withoutRetry.metrics.lostWrites).toBe(20);
    expect(withRetry.metrics.lostWrites).toBe(0);
    expect(withRetry.metrics.duplicateOps).toBe(0);
  });
});

describe('disk_failure', () => {
  test('the queue loses its stored jobs', () => {
    const board = makeBoard(
      [
        makeNode('src', 'traffic_source'),
        makeNode('app', 'app_server', { capacityRps: 100_000 }),
        makeNode('q', 'queue'),
        makeNode('w', 'worker', { capacityRps: 10 }),
        makeNode('db', 'db_primary'),
      ],
      [
        ['src', 'app'],
        ['app', 'q'],
        ['q', 'w'],
        ['w', 'db'],
      ],
    );
    const event = makeEvent(5, 'disk_failure', { nodeType: 'queue', durationSec: 0 });

    const healthy = runToEnd(makeConfig(board, { traffic: WRITES }));
    const failed = runToEnd(makeConfig(board, { traffic: WRITES, events: [event] }));

    expect(healthy.metrics.lostWrites).toBe(0);
    expect(failed.metrics.lostWrites).toBeGreaterThan(400);
  });

  test('the primary loses writes not yet synced (lossWindowMs)', () => {
    const event = makeEvent(5, 'disk_failure', { nodeType: 'db_primary', lossWindowMs: 1000, durationSec: 0 });
    const plainOutage = makeEvent(5, 'node_failure', { nodeType: 'db_primary', durationSec: 0 });

    const disk = runToEnd(makeConfig(simpleBoard(), { traffic: WRITES, events: [event] }));
    const outage = runToEnd(makeConfig(simpleBoard(), { traffic: WRITES, events: [plainOutage] }));

    expect(disk.metrics.lostWrites - outage.metrics.lostWrites).toBe(100);
  });
});

describe('cache_flush', () => {
  test('the cache goes cold, the database takes the misses, then it warms up', () => {
    const board = makeBoard(
      [
        makeNode('src', 'traffic_source'),
        makeNode('app', 'app_server', { capacityRps: 100_000 }),
        makeNode('cache', 'cache', { params: { hitRate: 1 } }),
        makeNode('db', 'db_primary'),
      ],
      [
        ['src', 'app'],
        ['app', 'cache'],
        ['cache', 'db'],
      ],
    );
    const event = makeEvent(3, 'cache_flush', { warmupSec: 4 });

    const run = runCollecting(makeConfig(board, { traffic: READS, events: [event] }));

    const cacheToDb = edgeId('cache', 'db');
    expect(flowCount(run, cacheToDb, undefined, { toSec: 3 })).toBe(0);
    expect(flowCount(run, cacheToDb, undefined, { fromSec: 3, toSec: 4 })).toBeGreaterThan(150);
    expect(flowCount(run, cacheToDb, undefined, { fromSec: 6, toSec: 7 })).toBeLessThan(60);
    expect(flowCount(run, cacheToDb, undefined, { fromSec: 7 })).toBe(0);
  });
});

describe('event edge cases', () => {
  test('cache_flush with warmupSec 0 still forces misses on the flush tick', () => {
    const board = makeBoard(
      [
        makeNode('src', 'traffic_source'),
        makeNode('app', 'app_server', { capacityRps: 100_000 }),
        makeNode('cache', 'cache', { params: { hitRate: 1 } }),
        makeNode('db', 'db_primary'),
      ],
      [
        ['src', 'app'],
        ['app', 'cache'],
        ['cache', 'db'],
      ],
    );
    const event = makeEvent(3, 'cache_flush', { warmupSec: 0 });

    const run = runCollecting(makeConfig(board, { traffic: READS, events: [event] }));

    expect(flowCount(run, edgeId('cache', 'db'))).toBe(20);
  });

  test('two disk failures on the primary do not count the same write twice', () => {
    const first = makeEvent(5, 'disk_failure', { nodeType: 'db_primary', lossWindowMs: 2000, durationSec: 0 });
    const second = makeEvent(5.5, 'disk_failure', { nodeType: 'db_primary', lossWindowMs: 2000, durationSec: 0 });

    const once = runToEnd(makeConfig(simpleBoard(), { traffic: WRITES, events: [first] }));
    const twice = runToEnd(makeConfig(simpleBoard(), { traffic: WRITES, events: [first, second] }));

    // Between the two failures only 4 write ticks fit (the tick of the 1st failure is down) + the tick lost in the 2nd.
    expect(twice.metrics.lostWrites - once.metrics.lostWrites).toBe(50);
  });

  test('a short failure does not shorten a long one in progress', () => {
    const long = makeEvent(1, 'node_failure', { nodeId: 'app', durationSec: 5 });
    const short = makeEvent(2, 'node_failure', { nodeId: 'app', durationSec: 1 });

    const run = runCollecting(makeConfig(simpleBoard(), { traffic: READS, events: [long, short] }));

    expect(dropCount(run, 'node_down')).toBe(5 * 200);
  });

  test('a write that runs out of retries counts as lost, only once', () => {
    const retry = makeEvent(0, 'client_retry', { timeoutMs: 10_000, maxRetries: 2 });
    const outage = makeEvent(2, 'node_failure', { nodeId: 'db' });

    const result = runToEnd(makeConfig(simpleBoard(), { traffic: WRITES, events: [retry, outage], durationSec: 4 }));

    // 200 writes are born with the database down; the 20 of the last two ticks still have a pending retry at the end.
    expect(result.metrics.lostWrites).toBe(180);
  });

  test('the end of the partition restores the flow', () => {
    const event = makeEvent(4, 'network_partition', { fromId: 'db', toId: 'app', durationSec: 2 });

    const run = runCollecting(makeConfig(simpleBoard(), { traffic: READS, events: [event] }));

    expect(flowCount(run, edgeId('app', 'db'), undefined, { fromSec: 6, toSec: 7 })).toBe(200);
  });

  test('traffic_ramp without a duration changes the rate at once', () => {
    const event = makeEvent(2, 'traffic_ramp', { toRps: 1000 });

    const run = runCollecting(makeConfig(simpleBoard(), { traffic: READS, events: [event] }));

    expect(flowCount(run, edgeId('src', 'app'), undefined, { fromSec: 2, toSec: 3 })).toBe(1000);
  });

  test('a low, fractional rate per tick produces the exact count', () => {
    const run = runCollecting(makeConfig(simpleBoard(), { traffic: { baseRps: 3, mix: makeMix({ read: 1 }) } }));

    expect(flowCount(run, edgeId('src', 'app'))).toBe(30);
  });
});
