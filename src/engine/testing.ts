import { createSimulation } from './simulation';
import type {
  Board,
  BoardNode,
  ComponentSpec,
  ComponentType,
  RequestKind,
  ScheduledEvent,
  SimConfig,
  SimEventType,
  SimResult,
  TickSnapshot,
  TrafficConfig,
} from './types';

const HUGE_CAPACITY = 1_000_000;

/** Specs folgadas: cada teste aperta só o que quer observar. */
const DEFAULT_SPECS: Readonly<Record<ComponentType, ComponentSpec>> = {
  traffic_source: { capacityRps: HUGE_CAPACITY, baseLatencyMs: 0, costTier: 'low', bufferSize: 0, params: {} },
  load_balancer: { capacityRps: HUGE_CAPACITY, baseLatencyMs: 1, costTier: 'low', bufferSize: 0, params: {} },
  app_server: { capacityRps: 500, baseLatencyMs: 10, costTier: 'low', bufferSize: 0, params: {} },
  cache: { capacityRps: HUGE_CAPACITY, baseLatencyMs: 1, costTier: 'low', bufferSize: 0, params: { hitRate: 0.8 } },
  db_primary: { capacityRps: HUGE_CAPACITY, baseLatencyMs: 1, costTier: 'mid', bufferSize: 0, params: {} },
  db_replica: {
    capacityRps: HUGE_CAPACITY,
    baseLatencyMs: 1,
    costTier: 'mid',
    bufferSize: 0,
    params: { replicationLagMs: 500 },
  },
  queue: { capacityRps: HUGE_CAPACITY, baseLatencyMs: 1, costTier: 'low', bufferSize: 100_000, params: {} },
  worker: { capacityRps: 100, baseLatencyMs: 1, costTier: 'low', bufferSize: 0, params: {} },
  rate_limiter: { capacityRps: HUGE_CAPACITY, baseLatencyMs: 1, costTier: 'low', bufferSize: 0, params: { limitRps: 0 } },
};

export type SpecOverrides = Partial<Omit<ComponentSpec, 'params'>> & { readonly params?: Record<string, number> };

export function makeNode(id: string, type: ComponentType, overrides: SpecOverrides = {}): BoardNode {
  const defaults = DEFAULT_SPECS[type];
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    spec: { ...defaults, ...overrides, params: { ...defaults.params, ...overrides.params } },
  };
}

export function edgeId(from: string, to: string): string {
  return `${from}->${to}`;
}

/** Monta um tabuleiro; cada link `[de, para]` vira uma aresta com id `de->para`. */
export function makeBoard(nodes: readonly BoardNode[], links: readonly (readonly [string, string])[]): Board {
  return {
    nodes,
    edges: links.map(([from, to]) => ({ id: edgeId(from, to), from, to })),
  };
}

export function makeMix(mix: Partial<Record<RequestKind, number>>): TrafficConfig['mix'] {
  return { read: 0, write: 0, bot: 0, ...mix };
}

export function makeEvent(atSec: number, type: SimEventType, params: ScheduledEvent['params'] = {}): ScheduledEvent {
  return { atSec, type, params, conceptId: 'test' };
}

export function makeConfig(board: Board, overrides: Partial<Omit<SimConfig, 'board'>> = {}): SimConfig {
  return {
    board,
    traffic: { baseRps: 100, mix: makeMix({ read: 1 }) },
    events: [],
    slos: [],
    durationSec: 10,
    seed: 42,
    ...overrides,
  };
}

export interface Run {
  readonly snapshots: readonly TickSnapshot[];
  readonly result: SimResult;
}

export function runCollecting(config: SimConfig): Run {
  const simulation = createSimulation(config);
  const snapshots: TickSnapshot[] = [];
  while (!simulation.isFinished()) snapshots.push(simulation.step());
  return { snapshots, result: simulation.result() };
}

export interface TickRange {
  readonly fromSec?: number;
  readonly toSec?: number;
}

function inRange(snapshot: TickSnapshot, { fromSec = 0, toSec = Infinity }: TickRange): boolean {
  return snapshot.timeSec >= fromSec && snapshot.timeSec < toSec;
}

/** Requisições que cruzaram a aresta, opcionalmente só de um tipo e num intervalo [fromSec, toSec). */
export function flowCount(run: Run, edge: string, kind?: RequestKind, range: TickRange = {}): number {
  return run.snapshots
    .filter((snapshot) => inRange(snapshot, range))
    .flatMap((snapshot) => snapshot.flows)
    .filter((flow) => flow.edgeId === edge && (kind === undefined || flow.kind === kind))
    .reduce((sum, flow) => sum + flow.count, 0);
}

export function dropCount(run: Run, reason: string, range: TickRange = {}): number {
  return run.snapshots
    .filter((snapshot) => inRange(snapshot, range))
    .flatMap((snapshot) => snapshot.drops)
    .filter((drop) => drop.reason === reason)
    .reduce((sum, drop) => sum + drop.count, 0);
}
