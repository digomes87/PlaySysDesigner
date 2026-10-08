import type { Board } from '../engine/types';
import { addNode, connect, disconnect, nodeFromPalette } from './boardOps';
import type { Level } from './schema';

/**
 * Tabuleiros de referência usados só pelos testes de conteúdo: provam que cada
 * fase tem solução e que os atalhos errados reprovam pelo motivo esperado.
 * Nada aqui é importado pelo app.
 */
export interface BoardPlan {
  /** Pares [id da peça na paleta, id do novo nó]. */
  readonly add?: readonly (readonly [string, string])[];
  readonly removeEdges?: readonly string[];
  readonly connect?: readonly (readonly [string, string])[];
}

export function applyPlan(level: Level, plan: BoardPlan): Board {
  let board: Board = level.initialBoard;
  (plan.add ?? []).forEach(([paletteId, nodeId], index) => {
    const item = level.availableComponents.find((candidate) => candidate.id === paletteId);
    if (!item) throw new Error(`${level.id}: peça "${paletteId}" não existe na paleta.`);
    board = addNode(board, nodeFromPalette(item, nodeId, { x: 0, y: index * 80 }));
  });
  for (const edgeId of plan.removeEdges ?? []) board = disconnect(board, edgeId);
  for (const [from, to] of plan.connect ?? []) board = connect(board, from, to);
  return board;
}

type Link = readonly [string, string];

function fanOut(from: string, targets: readonly string[]): Link[] {
  return targets.map((to): Link => [from, to]);
}

function fanIn(sources: readonly string[], to: string): Link[] {
  return sources.map((from): Link => [from, to]);
}

function numbered(prefix: string, from: number, to: number): string[] {
  return Array.from({ length: to - from + 1 }, (_, index) => `${prefix}-${from + index}`);
}

function level01(serverCount: number): BoardPlan {
  const added = numbered('app', 2, serverCount);
  return {
    add: [['load-balancer', 'lb'], ...added.map((id): Link => ['app-server', id])],
    removeEdges: ['src->app-1'],
    connect: [['src', 'lb'], ...fanOut('lb', ['app-1', ...added]), ...fanIn(added, 'db')],
  };
}

function level02(options: { cache: boolean; replicas: readonly string[] }): BoardPlan {
  const replicaIds = options.replicas.map((_, index) => `rep-${index + 1}`);
  const apps = ['app-1', 'app-2'];
  // Sem réplica, o miss do cache só tem o primário para onde ir.
  const cacheTargets = replicaIds.length > 0 ? replicaIds : ['db'];
  const readTier = options.cache
    ? [...fanIn(apps, 'cache'), ...fanOut('cache', cacheTargets)]
    : apps.flatMap((app) => fanOut(app, replicaIds));
  return {
    add: [
      ...(options.cache ? [['cache', 'cache'] as const] : []),
      ...options.replicas.map((paletteId, index): Link => [paletteId, replicaIds[index] ?? paletteId]),
    ],
    connect: readTier,
  };
}

function level03(options: { queue: boolean; workers: number; limiter: boolean }): BoardPlan {
  const workers = numbered('w', 1, options.workers);
  const apps = ['app-1', 'app-2'];
  const asyncTier = options.queue ? [...fanIn(apps, 'q'), ...fanOut('q', workers), ...fanIn(workers, 'db')] : [];
  return {
    add: [
      ...(options.queue ? [['queue', 'q'] as const, ...workers.map((id): Link => ['worker', id])] : []),
      ...(options.limiter ? [['rate-limiter', 'rl'] as const] : []),
    ],
    removeEdges: options.limiter ? ['src->lb'] : [],
    connect: [...asyncTier, ...(options.limiter ? ([['src', 'rl'], ['rl', 'lb']] as const) : [])],
  };
}

function level04(options: { replica: string; workers: number; limiter: boolean }): BoardPlan {
  const addedApps = numbered('app', 2, 4);
  const apps = ['app-1', ...addedApps];
  const replicas = ['rep-1', 'rep-2'];
  const workers = numbered('w', 1, options.workers);
  const entry: Link[] = options.limiter ? [['src', 'rl'], ['rl', 'lb']] : [['src', 'lb']];
  return {
    add: [
      ['load-balancer', 'lb'],
      ...addedApps.map((id): Link => ['app-server', id]),
      ['cache', 'cache'],
      ...replicas.map((id): Link => [options.replica, id]),
      ['queue', 'q'],
      ...workers.map((id): Link => ['worker', id]),
      ...(options.limiter ? [['rate-limiter', 'rl'] as const] : []),
    ],
    removeEdges: ['src->app-1'],
    connect: [
      ...entry,
      ...fanOut('lb', apps),
      ...fanIn(apps, 'cache'),
      ...fanOut('cache', replicas),
      ...fanIn(apps, 'q'),
      ...fanOut('q', workers),
      ...fanIn(workers, 'db'),
    ],
  };
}

export const REFERENCE_SOLUTIONS: Readonly<Record<string, BoardPlan>> = {
  'level-01': level01(5),
  'level-02': level02({ cache: true, replicas: ['replica-near', 'replica-near'] }),
  'level-03': level03({ queue: true, workers: 2, limiter: true }),
  'level-04': level04({ replica: 'replica-near', workers: 1, limiter: true }),
};

export interface Trap {
  readonly name: string;
  readonly plan: BoardPlan;
  /** Métrica cujo SLO o atalho deve violar. */
  readonly violates: string;
}

/** Atalhos tentadores que a fase precisa reprovar; é o que a torna uma aula. */
export const TRAPS: Readonly<Record<string, readonly Trap[]>> = {
  'level-01': [{ name: 'servidores no limite exato do pico', plan: level01(4), violates: 'p99LatencyMs' }],
  'level-02': [
    { name: 'só cache', plan: level02({ cache: true, replicas: [] }), violates: 'errorRate' },
    {
      name: 'réplicas distantes',
      plan: level02({ cache: true, replicas: ['replica-far', 'replica-far'] }),
      violates: 'staleReads',
    },
    {
      name: 'réplicas no lugar do cache',
      plan: level02({ cache: false, replicas: Array.from({ length: 6 }, () => 'replica-near') }),
      violates: 'costTier',
    },
  ],
  'level-03': [
    { name: 'sem fila', plan: level03({ queue: false, workers: 0, limiter: true }), violates: 'lostWrites' },
    { name: 'sem rate limiter', plan: level03({ queue: true, workers: 2, limiter: false }), violates: 'errorRate' },
    { name: 'workers mais rápidos que o banco', plan: level03({ queue: true, workers: 3, limiter: true }), violates: 'lostWrites' },
  ],
  'level-04': [
    { name: 'réplicas distantes', plan: level04({ replica: 'replica-far', workers: 1, limiter: true }), violates: 'staleReads' },
    { name: 'workers mais rápidos que o banco', plan: level04({ replica: 'replica-near', workers: 2, limiter: true }), violates: 'lostWrites' },
    { name: 'sem rate limiter', plan: level04({ replica: 'replica-near', workers: 1, limiter: false }), violates: 'errorRate' },
  ],
};
