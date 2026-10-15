/**
 * Engine contracts. Nothing here depends on React or the DOM: the simulation runs
 * headless, in discrete ticks, and is deterministic for a given seed.
 */

export const TICK_MS = 100;
export const TICKS_PER_SEC = 1000 / TICK_MS;
/** Ceiling of a component's latency, in multiples of `baseLatencyMs`. */
export const LATENCY_CEILING_FACTOR = 20;
/** Sliding window used for p99 and errorRate when checking SLOs. */
export const SLO_WINDOW_SEC = 5;
/** Below this the window has no sample for p99/errorRate yet: a single failure does not fail the run. */
export const SLO_MIN_SAMPLES = 10;
/** A second counts as available if its error rate stays within this limit. */
export const AVAILABILITY_ERROR_THRESHOLD = 0.05;
export const MAX_HOPS = 16;
export const DEFAULT_KEYSPACE = 1000;

export const COMPONENT_TYPES = [
  'traffic_source',
  'load_balancer',
  'app_server',
  'cache',
  'db_primary',
  'db_replica',
  'queue',
  'worker',
  'rate_limiter',
] as const;
export type ComponentType = (typeof COMPONENT_TYPES)[number];

export const REQUEST_KINDS = ['read', 'write', 'bot'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

export const COST_TIERS = ['low', 'mid', 'high'] as const;
export type CostTier = (typeof COST_TIERS)[number];

export interface ComponentSpec {
  readonly capacityRps: number;
  readonly baseLatencyMs: number;
  readonly costTier: CostTier;
  readonly bufferSize: number;
  /** Per-type extras (hitRate, replicationLagMs, limitRps...). Opaque to the core. */
  readonly params: Readonly<Record<string, number>>;
}

export interface BoardNode {
  readonly id: string;
  readonly type: ComponentType;
  readonly spec: ComponentSpec;
  /** Used by the UI only. */
  readonly position: { readonly x: number; readonly y: number };
  /** Component of the initial system: the player cannot remove it. */
  readonly locked?: boolean;
  /** Palette component the node came from; the engine ignores it. */
  readonly paletteId?: string;
}

export interface BoardEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
}

export interface Board {
  readonly nodes: readonly BoardNode[];
  readonly edges: readonly BoardEdge[];
}

/** A request in flight. Only the core changes `latencyMs` and `hops`. */
export interface SimRequest {
  readonly id: number;
  readonly kind: RequestKind;
  /** Data key read or written; basis for staleReads and cache invalidation. */
  readonly key: number;
  /** Operation identity; a retry repeats the opId, which lets duplicateOps be counted. */
  readonly opId: number;
  readonly bornAtMs: number;
  readonly sourceId: string;
  /** 0 on the first attempt. */
  readonly attempt: number;
  /** Work already acknowledged to the client (left a queue); not counted in latency or errors. */
  readonly async: boolean;
  latencyMs: number;
  hops: number;
}

export type DropReason = 'saturated' | 'rate_limited' | 'node_down' | 'no_route' | 'partitioned';

export type RouteDecision =
  /** Moves on to the next output; the router chooses it (priority + round-robin). */
  | { readonly action: 'forward' }
  | { readonly action: 'respond'; readonly stale?: boolean }
  /** Answers the client and the component keeps the work to process later. */
  | { readonly action: 'ack' }
  | { readonly action: 'drop'; readonly reason: DropReason };

/** A behaviour's view of its own node during the simulation. */
export interface NodeRuntime<TState = unknown> {
  readonly node: BoardNode;
  readonly state: TState;
  /** Demand / capacity in the previous tick. */
  readonly utilization: number;
  readonly down: boolean;
}

export interface SimContext {
  readonly nowMs: number;
  /** The run's PRNG, in [0, 1). */
  random(): number;
  lastWriteAtMs(key: number): number | undefined;
  /** Stores the write durably and counts a duplicate if the opId was already stored. */
  commitWrite(req: SimRequest): void;
  /** Hands work to an output with spare capacity now; false if none can take it. */
  dispatch(req: SimRequest, fromNodeId: string): boolean;
  addLostWrites(count: number): void;
}

/**
 * Behaviour of a component type. The core handles capacity, buffer,
 * latency and routing; only what is specific to the type lives here.
 */
export interface ComponentBehavior<TState = unknown> {
  /** Routing priority per request type; higher wins, equals take turns. */
  readonly priority: Readonly<Record<RequestKind, number>>;
  createState(node: BoardNode): TState;
  accepts(req: SimRequest, node: BoardNode): boolean;
  handle(req: SimRequest, node: NodeRuntime<TState>, ctx: SimContext): RouteDecision;
  onTick?(node: NodeRuntime<TState>, ctx: SimContext): void;
  onEvent?(event: ScheduledEvent, node: NodeRuntime<TState>, ctx: SimContext): void;
  /** Work held by the component itself (e.g. queue depth). */
  backlog?(node: NodeRuntime<TState>): number;
}

export const SIM_EVENT_TYPES = [
  'traffic_ramp',
  'traffic_spike',
  'bot_wave',
  'node_failure',
  'network_partition',
  'client_retry',
  'disk_failure',
  'cache_flush',
] as const;
export type SimEventType = (typeof SIM_EVENT_TYPES)[number];

export type EventParams = Readonly<Record<string, number | string>>;

export interface ScheduledEvent {
  readonly atSec: number;
  readonly type: SimEventType;
  readonly params: EventParams;
  readonly conceptId: string;
}

export interface RetryPolicy {
  /** A response slower than this is treated by the client as a failure. */
  readonly timeoutMs: number;
  readonly maxRetries: number;
}

/** Traffic levers that events can pull. */
export interface TrafficControl {
  startRamp(toRps: number, nowMs: number, durationMs: number): void;
  addMultiplier(factor: number, untilMs: number): void;
  addBotWave(rps: number, untilMs: number): void;
  setRetryPolicy(policy: RetryPolicy, untilMs: number): void;
}

export interface EventContext {
  readonly nowMs: number;
  readonly traffic: TrafficControl;
  /** Target nodes: `nodeId`, or the first `count` (default 1) of `nodeType`. */
  targets(params: EventParams): readonly NodeRuntime[];
  failNode(nodeId: string, untilMs: number): void;
  cutEdges(fromId: string, toId: string, untilMs: number): void;
  /** Forwards the event to the node's behaviour (`onEvent`). */
  notify(event: ScheduledEvent, nodeId: string): void;
}

export type EventHandler = (event: ScheduledEvent, ctx: EventContext) => void;

export interface TrafficConfig {
  readonly baseRps: number;
  readonly mix: Readonly<Record<RequestKind, number>>;
  /** Number of distinct keys; fewer = more collisions between reads and writes. */
  readonly keyspace?: number;
}

export interface Metrics {
  readonly p99LatencyMs: number;
  readonly errorRate: number;
  readonly availability: number;
  readonly costTier: CostTier;
  readonly staleReads: number;
  readonly duplicateOps: number;
  readonly lostWrites: number;
}
export type MetricId = keyof Metrics;

export interface Slo {
  readonly metric: MetricId;
  readonly op: 'lte' | 'gte';
  readonly value: number | CostTier;
}

export interface SloViolation {
  readonly metric: MetricId;
  readonly atSec: number;
  readonly observed: number | CostTier;
}

/** Maximum sum of cost points (low=1, mid=2, high=3) for the board to stay in each tier. */
export interface CostBudget {
  readonly low: number;
  readonly mid: number;
}

export interface SimConfig {
  readonly board: Board;
  readonly traffic: TrafficConfig;
  readonly events: readonly ScheduledEvent[];
  readonly slos: readonly Slo[];
  readonly durationSec: number;
  readonly seed: number;
  readonly costBudget?: CostBudget;
}

export interface NodeSnapshot {
  readonly utilization: number;
  readonly queued: number;
  readonly down: boolean;
}

export interface FlowSnapshot {
  readonly edgeId: string;
  readonly kind: RequestKind;
  readonly count: number;
}

export interface DropSnapshot {
  readonly nodeId: string;
  readonly reason: DropReason;
  readonly count: number;
}

export interface TickSnapshot {
  readonly tick: number;
  readonly timeSec: number;
  /** p99 and errorRate of the current window; other metrics are cumulative. */
  readonly metrics: Metrics;
  readonly nodes: Readonly<Record<string, NodeSnapshot>>;
  /** Requests that crossed each edge this tick; feeds the particles. */
  readonly flows: readonly FlowSnapshot[];
  readonly drops: readonly DropSnapshot[];
  readonly firedEvents: readonly ScheduledEvent[];
}

export interface SimResult {
  readonly passed: boolean;
  /** Metrics of the whole run. */
  readonly metrics: Metrics;
  readonly violations: readonly SloViolation[];
  /** The earliest violation; picks the diagnose question. */
  readonly firstViolation: SloViolation | null;
}

export interface Simulation {
  step(): TickSnapshot;
  isFinished(): boolean;
  result(): SimResult;
}
