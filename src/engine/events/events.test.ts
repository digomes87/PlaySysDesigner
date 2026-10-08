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
  test('todo tipo de evento tem handler', () => {
    for (const type of SIM_EVENT_TYPES) {
      expect(EVENT_HANDLERS[type]).toBeTypeOf('function');
    }
  });

  test('evento aparece em firedEvents no tick em que dispara, uma vez só', () => {
    const event = makeEvent(2, 'traffic_spike', { multiplier: 2, durationSec: 1 });

    const run = runCollecting(makeConfig(simpleBoard(), { events: [event] }));

    const firedAt = run.snapshots.filter((snapshot) => snapshot.firedEvents.length > 0).map((snapshot) => snapshot.timeSec);
    expect(firedAt).toEqual([2]);
  });

  test('parâmetro obrigatório ausente falha com mensagem clara', () => {
    const config = makeConfig(simpleBoard(), { events: [makeEvent(0, 'traffic_ramp', {})] });

    expect(() => runToEnd(config)).toThrow(/toRps/);
  });
});

describe('traffic_ramp', () => {
  test('leva o tráfego de baseRps até toRps de forma linear', () => {
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
  test('multiplica o tráfego só durante a janela', () => {
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
  test('soma tráfego de bot durante a janela, sem mexer no legítimo', () => {
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

  test('nó único fora do ar derruba tudo até voltar', () => {
    const run = runCollecting(makeConfig(simpleBoard(), { traffic: READS, events: [failure] }));

    expect(dropCount(run, 'node_down', { toSec: 4 })).toBe(0);
    expect(dropCount(run, 'node_down', { fromSec: 4, toSec: 6 })).toBe(400);
    expect(dropCount(run, 'node_down', { fromSec: 6 })).toBe(0);
    expect(run.snapshots.find((snapshot) => snapshot.timeSec === 5)?.nodes.app?.down).toBe(true);
    expect(run.result.metrics.availability).toBe(0.8);
  });

  test('com redundância atrás do load balancer a falha não gera erro', () => {
    const run = runCollecting(makeConfig(redundantBoard(), { traffic: READS, events: [failure] }));

    expect(run.result.metrics.errorRate).toBe(0);
    expect(flowCount(run, edgeId('lb', 'app1'), undefined, { fromSec: 4, toSec: 6 })).toBe(0);
    expect(flowCount(run, edgeId('lb', 'app2'), undefined, { fromSec: 4, toSec: 6 })).toBe(400);
  });

  test('aceita alvo por nodeId e, sem durationSec, a falha é permanente', () => {
    const event = makeEvent(4, 'node_failure', { nodeId: 'db' });

    const run = runCollecting(makeConfig(simpleBoard(), { traffic: READS, events: [event] }));

    expect(dropCount(run, 'node_down', { fromSec: 4 })).toBe(1200);
  });

  test('requisições no buffer do nó que cai são perdidas', () => {
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
  test('corta a ligação entre dois nós durante a janela', () => {
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

  test('retry de escrita lenta que já foi gravada gera duplicateOps', () => {
    const event = makeEvent(0, 'client_retry', { timeoutMs: 200, maxRetries: 1 });

    const result = runToEnd(makeConfig(slowPrimaryBoard(), { traffic, events: [event] }));

    expect(result.metrics.duplicateOps).toBeGreaterThan(0);
  });

  test('sem retry não há duplicata', () => {
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

  test('escrita descartada que o retry consegue gravar não conta como perdida', () => {
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
  test('fila perde os trabalhos guardados', () => {
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

  test('primário perde as escritas ainda não sincronizadas (lossWindowMs)', () => {
    const event = makeEvent(5, 'disk_failure', { nodeType: 'db_primary', lossWindowMs: 1000, durationSec: 0 });
    const plainOutage = makeEvent(5, 'node_failure', { nodeType: 'db_primary', durationSec: 0 });

    const disk = runToEnd(makeConfig(simpleBoard(), { traffic: WRITES, events: [event] }));
    const outage = runToEnd(makeConfig(simpleBoard(), { traffic: WRITES, events: [plainOutage] }));

    expect(disk.metrics.lostWrites - outage.metrics.lostWrites).toBe(100);
  });
});

describe('cache_flush', () => {
  test('cache esfria, o banco recebe os misses e depois reaquece', () => {
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

describe('casos de borda dos eventos', () => {
  test('cache_flush com warmupSec 0 ainda força misses no tick do flush', () => {
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

  test('duas falhas de disco no primário não contam a mesma escrita duas vezes', () => {
    const first = makeEvent(5, 'disk_failure', { nodeType: 'db_primary', lossWindowMs: 2000, durationSec: 0 });
    const second = makeEvent(5.5, 'disk_failure', { nodeType: 'db_primary', lossWindowMs: 2000, durationSec: 0 });

    const once = runToEnd(makeConfig(simpleBoard(), { traffic: WRITES, events: [first] }));
    const twice = runToEnd(makeConfig(simpleBoard(), { traffic: WRITES, events: [first, second] }));

    // Entre as duas falhas só cabem 4 ticks de gravação (o tick da 1ª falha fica fora do ar) + o tick perdido na 2ª.
    expect(twice.metrics.lostWrites - once.metrics.lostWrites).toBe(50);
  });

  test('falha curta não encurta uma falha longa já em curso', () => {
    const long = makeEvent(1, 'node_failure', { nodeId: 'app', durationSec: 5 });
    const short = makeEvent(2, 'node_failure', { nodeId: 'app', durationSec: 1 });

    const run = runCollecting(makeConfig(simpleBoard(), { traffic: READS, events: [long, short] }));

    expect(dropCount(run, 'node_down')).toBe(5 * 200);
  });

  test('escrita que esgota os retries conta como perdida, uma vez só', () => {
    const retry = makeEvent(0, 'client_retry', { timeoutMs: 10_000, maxRetries: 2 });
    const outage = makeEvent(2, 'node_failure', { nodeId: 'db' });

    const result = runToEnd(makeConfig(simpleBoard(), { traffic: WRITES, events: [retry, outage], durationSec: 4 }));

    // Nascem 200 escritas com o banco fora; as 20 dos dois últimos ticks ainda têm retry pendente no fim.
    expect(result.metrics.lostWrites).toBe(180);
  });

  test('fim da partição devolve o fluxo', () => {
    const event = makeEvent(4, 'network_partition', { fromId: 'db', toId: 'app', durationSec: 2 });

    const run = runCollecting(makeConfig(simpleBoard(), { traffic: READS, events: [event] }));

    expect(flowCount(run, edgeId('app', 'db'), undefined, { fromSec: 6, toSec: 7 })).toBe(200);
  });

  test('traffic_ramp sem duração troca a taxa na hora', () => {
    const event = makeEvent(2, 'traffic_ramp', { toRps: 1000 });

    const run = runCollecting(makeConfig(simpleBoard(), { traffic: READS, events: [event] }));

    expect(flowCount(run, edgeId('src', 'app'), undefined, { fromSec: 2, toSec: 3 })).toBe(1000);
  });

  test('taxa baixa e fracionária por tick gera a contagem exata', () => {
    const run = runCollecting(makeConfig(simpleBoard(), { traffic: { baseRps: 3, mix: makeMix({ read: 1 }) } }));

    expect(flowCount(run, edgeId('src', 'app'))).toBe(30);
  });
});
