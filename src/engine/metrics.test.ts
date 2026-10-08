import { describe, expect, test } from 'vitest';
import { boardCostTier } from './cost';
import { LatencyHistogram, MetricsCollector } from './metrics';
import { mulberry32 } from './prng';
import { SloTracker, sloHolds } from './slo';
import { makeBoard, makeNode } from './testing';
import { SLO_MIN_SAMPLES, TICKS_PER_SEC, type Metrics } from './types';

const BASE_METRICS: Metrics = {
  p99LatencyMs: 100,
  errorRate: 0,
  availability: 1,
  costTier: 'mid',
  staleReads: 0,
  duplicateOps: 0,
  lostWrites: 0,
};

describe('mulberry32', () => {
  test('repete a sequência para a mesma seed', () => {
    const first = mulberry32(7);
    const second = mulberry32(7);

    const sequence = Array.from({ length: 5 }, () => first());

    expect(Array.from({ length: 5 }, () => second())).toEqual(sequence);
  });

  test('gera sequências diferentes para seeds diferentes', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  test('fica em [0, 1)', () => {
    const random = mulberry32(123);

    const values = Array.from({ length: 1000 }, () => random());

    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
  });
});

describe('LatencyHistogram', () => {
  test('devolve 0 quando vazio', () => {
    expect(new LatencyHistogram().percentile(0.99)).toBe(0);
  });

  test('calcula o p99 de uma distribuição conhecida', () => {
    const histogram = new LatencyHistogram();
    for (let ms = 1; ms <= 100; ms += 1) histogram.add(ms, 1);

    expect(histogram.percentile(0.99)).toBe(99);
    expect(histogram.percentile(0.5)).toBe(50);
  });

  test('remove amostras ao sair da janela', () => {
    const histogram = new LatencyHistogram();
    histogram.add(10, 99);
    histogram.add(900, 1);

    histogram.add(900, -1);

    expect(histogram.percentile(1)).toBe(10);
  });
});

describe('MetricsCollector', () => {
  test('errorRate da janela esquece erros antigos, o total não', () => {
    const collector = new MetricsCollector('low');
    for (let index = 0; index < SLO_MIN_SAMPLES; index += 1) collector.recordError();
    expect(collector.endTick().errorRate).toBe(1);

    let windowed = collector.endTick();
    for (let tick = 0; tick < 10 * TICKS_PER_SEC; tick += 1) {
      collector.recordOk(10);
      windowed = collector.endTick();
    }

    expect(windowed.errorRate).toBe(0);
    expect(collector.totals().errorRate).toBeGreaterThan(0);
  });

  test('janela com menos de SLO_MIN_SAMPLES respostas não acusa erro nem latência', () => {
    const collector = new MetricsCollector('low');
    for (let index = 0; index < SLO_MIN_SAMPLES - 1; index += 1) collector.recordError();

    const sparse = collector.endTick();
    collector.recordError();
    const enough = collector.endTick();

    expect(sparse.errorRate).toBe(0);
    expect(enough.errorRate).toBe(1);
  });

  test('availability é a fração de segundos com erro dentro do limite', () => {
    const collector = new MetricsCollector('low');
    for (let tick = 0; tick < 4 * TICKS_PER_SEC; tick += 1) {
      const isBadSecond = tick < TICKS_PER_SEC;
      if (isBadSecond) collector.recordError();
      else collector.recordOk(10);
      collector.endTick();
    }

    expect(collector.totals().availability).toBe(0.75);
  });
});

describe('SLO', () => {
  test('compara números com lte e gte', () => {
    expect(sloHolds({ metric: 'p99LatencyMs', op: 'lte', value: 100 }, BASE_METRICS)).toBe(true);
    expect(sloHolds({ metric: 'p99LatencyMs', op: 'lte', value: 99 }, BASE_METRICS)).toBe(false);
    expect(sloHolds({ metric: 'availability', op: 'gte', value: 0.999 }, BASE_METRICS)).toBe(true);
  });

  test('compara faixas de custo pela ordem low < mid < high', () => {
    expect(sloHolds({ metric: 'costTier', op: 'lte', value: 'high' }, BASE_METRICS)).toBe(true);
    expect(sloHolds({ metric: 'costTier', op: 'lte', value: 'low' }, BASE_METRICS)).toBe(false);
  });

  test('registra só a primeira violação de cada SLO', () => {
    const tracker = new SloTracker([{ metric: 'lostWrites', op: 'lte', value: 0 }]);

    tracker.check(BASE_METRICS, 1);
    tracker.check({ ...BASE_METRICS, lostWrites: 3 }, 2);
    tracker.check({ ...BASE_METRICS, lostWrites: 9 }, 3);

    expect(tracker.violations()).toEqual([{ metric: 'lostWrites', atSec: 2, observed: 3 }]);
  });
});

describe('boardCostTier', () => {
  const budget = { low: 2, mid: 4 };

  test('soma os pontos das peças e ignora a origem do tráfego', () => {
    const board = makeBoard([makeNode('src', 'traffic_source'), makeNode('app', 'app_server', { costTier: 'mid' })], []);

    expect(boardCostTier(board, budget)).toBe('low');
  });

  test('sobe de faixa quando a soma passa do orçamento', () => {
    const nodes = ['a', 'b', 'c'].map((id) => makeNode(id, 'app_server', { costTier: 'mid' }));

    expect(boardCostTier(makeBoard(nodes.slice(0, 2), []), budget)).toBe('mid');
    expect(boardCostTier(makeBoard(nodes, []), budget)).toBe('high');
  });
});
