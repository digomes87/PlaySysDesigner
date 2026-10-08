/**
 * Contratos do motor. Nada aqui depende de React nem do DOM: a simulação roda
 * headless, em ticks discretos, e é determinística para uma mesma seed.
 */

export const TICK_MS = 100;
export const TICKS_PER_SEC = 1000 / TICK_MS;
/** Teto da latência de um componente, em múltiplos de `baseLatencyMs`. */
export const LATENCY_CEILING_FACTOR = 20;
/** Janela deslizante usada para p99 e errorRate ao avaliar SLOs. */
export const SLO_WINDOW_SEC = 5;
/** Um segundo conta como disponível se a taxa de erro dele ficar até este limite. */
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
  /** Extras por tipo (hitRate, replicationLagMs, limitRps...). Opaco para o núcleo. */
  readonly params: Readonly<Record<string, number>>;
}

export interface BoardNode {
  readonly id: string;
  readonly type: ComponentType;
  readonly spec: ComponentSpec;
  /** Só a UI usa. */
  readonly position: { readonly x: number; readonly y: number };
  /** Peça do sistema inicial: o jogador não remove. */
  readonly locked?: boolean;
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

/** Uma requisição em trânsito. Só o núcleo altera `latencyMs` e `hops`. */
export interface SimRequest {
  readonly id: number;
  readonly kind: RequestKind;
  /** Chave de dado lida ou escrita; base de staleReads e da invalidação de cache. */
  readonly key: number;
  /** Identidade da operação; um retry repete o opId, o que permite contar duplicateOps. */
  readonly opId: number;
  readonly bornAtMs: number;
  readonly sourceId: string;
  /** 0 na primeira tentativa. */
  readonly attempt: number;
  /** Trabalho já confirmado ao cliente (saiu de uma fila); não entra em latência nem erro. */
  readonly async: boolean;
  latencyMs: number;
  hops: number;
}

export type DropReason = 'saturated' | 'rate_limited' | 'node_down' | 'no_route' | 'partitioned';

export type RouteDecision =
  /** Segue para a próxima saída; quem escolhe é o roteador (prioridade + round-robin). */
  | { readonly action: 'forward' }
  | { readonly action: 'respond'; readonly stale?: boolean }
  /** Responde ao cliente e o componente guarda o trabalho para processar depois. */
  | { readonly action: 'ack' }
  | { readonly action: 'drop'; readonly reason: DropReason };

/** Visão que um comportamento tem do próprio nó durante a simulação. */
export interface NodeRuntime<TState = unknown> {
  readonly node: BoardNode;
  readonly state: TState;
  /** Demanda / capacidade no tick anterior. */
  readonly utilization: number;
  readonly down: boolean;
}

export interface SimContext {
  readonly nowMs: number;
  /** PRNG da partida, em [0, 1). */
  random(): number;
  lastWriteAtMs(key: number): number | undefined;
  /** Grava a escrita no dado durável e conta duplicata se o opId já foi gravado. */
  commitWrite(req: SimRequest): void;
  /** Entrega trabalho a uma saída com folga agora; false se nenhuma puder receber. */
  dispatch(req: SimRequest, fromNodeId: string): boolean;
  addLostWrites(count: number): void;
}

/**
 * Comportamento de um tipo de componente. O núcleo cuida de capacidade, buffer,
 * latência e roteamento; aqui fica só o que o tipo tem de particular.
 */
export interface ComponentBehavior<TState = unknown> {
  /** Prioridade de roteamento por tipo de requisição; maior vence, iguais revezam. */
  readonly priority: Readonly<Record<RequestKind, number>>;
  createState(node: BoardNode): TState;
  accepts(req: SimRequest, node: BoardNode): boolean;
  handle(req: SimRequest, node: NodeRuntime<TState>, ctx: SimContext): RouteDecision;
  onTick?(node: NodeRuntime<TState>, ctx: SimContext): void;
  onEvent?(event: ScheduledEvent, node: NodeRuntime<TState>, ctx: SimContext): void;
  /** Trabalho guardado pelo próprio componente (ex.: profundidade da fila). */
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
  /** Resposta mais lenta que isto é tratada pelo cliente como falha. */
  readonly timeoutMs: number;
  readonly maxRetries: number;
}

/** Alavancas de tráfego que os eventos podem mexer. */
export interface TrafficControl {
  startRamp(toRps: number, nowMs: number, durationMs: number): void;
  addMultiplier(factor: number, untilMs: number): void;
  addBotWave(rps: number, untilMs: number): void;
  setRetryPolicy(policy: RetryPolicy, untilMs: number): void;
}

export interface EventContext {
  readonly nowMs: number;
  readonly traffic: TrafficControl;
  /** Nós alvo: `nodeId`, ou os primeiros `count` (padrão 1) de `nodeType`. */
  targets(params: EventParams): readonly NodeRuntime[];
  failNode(nodeId: string, untilMs: number): void;
  cutEdges(fromId: string, toId: string, untilMs: number): void;
  /** Repassa o evento ao comportamento do nó (`onEvent`). */
  notify(event: ScheduledEvent, nodeId: string): void;
}

export type EventHandler = (event: ScheduledEvent, ctx: EventContext) => void;

export interface TrafficConfig {
  readonly baseRps: number;
  readonly mix: Readonly<Record<RequestKind, number>>;
  /** Quantidade de chaves distintas; menor = mais colisão entre leitura e escrita. */
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

/** Soma máxima de pontos de custo (low=1, mid=2, high=3) para o tabuleiro ficar em cada faixa. */
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
  /** p99 e errorRate da janela corrente; demais métricas acumuladas. */
  readonly metrics: Metrics;
  readonly nodes: Readonly<Record<string, NodeSnapshot>>;
  /** Requisições que cruzaram cada aresta neste tick; alimenta as partículas. */
  readonly flows: readonly FlowSnapshot[];
  readonly drops: readonly DropSnapshot[];
  readonly firedEvents: readonly ScheduledEvent[];
}

export interface SimResult {
  readonly passed: boolean;
  /** Métricas da partida inteira. */
  readonly metrics: Metrics;
  readonly violations: readonly SloViolation[];
  /** A violação mais antiga; escolhe a pergunta de diagnóstico. */
  readonly firstViolation: SloViolation | null;
}

export interface Simulation {
  step(): TickSnapshot;
  isFinished(): boolean;
  result(): SimResult;
}
