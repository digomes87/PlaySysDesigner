import { BEHAVIORS } from './components/registry';
import { boardCostTier } from './cost';
import { EVENT_HANDLERS } from './events/registry';
import { MetricsCollector } from './metrics';
import { mulberry32, type Random } from './prng';
import { chooseRoute, type OutputLink } from './router';
import { SloTracker } from './slo';
import { TrafficState } from './traffic';
import {
  DEFAULT_KEYSPACE,
  LATENCY_CEILING_FACTOR,
  MAX_HOPS,
  TICK_MS,
  TICKS_PER_SEC,
  type Board,
  type BoardNode,
  type DropReason,
  type DropSnapshot,
  type EventContext,
  type EventParams,
  type FlowSnapshot,
  type NodeRuntime,
  type NodeSnapshot,
  type RequestKind,
  type ScheduledEvent,
  type SimConfig,
  type SimContext,
  type SimRequest,
  type SimResult,
  type Simulation,
  type TickSnapshot,
} from './types';

interface Pending {
  readonly req: SimRequest;
  readonly enqueuedAtMs: number;
}

/** Estado de um nó durante a partida. Só o núcleo escreve aqui. */
interface Slot extends NodeRuntime {
  utilization: number;
  down: boolean;
  downUntilMs: number;
  /** Requisições que o nó ainda pode processar neste tick. */
  budget: number;
  /** Backlog no início do tick + chegadas do tick. */
  demand: number;
  buffer: Pending[];
  readonly capacityPerTick: number;
  readonly outputs: OutputLink<Slot>[];
  readonly cursor: Map<string, number>;
}

function createSlot(node: BoardNode): Slot {
  return {
    node,
    state: BEHAVIORS[node.type].createState(node),
    utilization: 0,
    down: false,
    downUntilMs: 0,
    budget: 0,
    demand: 0,
    buffer: [],
    capacityPerTick: node.spec.capacityRps / TICKS_PER_SEC,
    outputs: [],
    cursor: new Map(),
  };
}

function buildSlots(board: Board): Map<string, Slot> {
  const slots = new Map<string, Slot>();
  for (const node of board.nodes) {
    if (slots.has(node.id)) throw new Error(`Tabuleiro inválido: id de nó repetido "${node.id}".`);
    slots.set(node.id, createSlot(node));
  }
  for (const edge of board.edges) {
    const from = slots.get(edge.from);
    const target = slots.get(edge.to);
    if (!from) throw new Error(`Tabuleiro inválido: aresta "${edge.id}" sai de um nó inexistente "${edge.from}".`);
    if (!target) throw new Error(`Tabuleiro inválido: aresta "${edge.id}" chega a um nó inexistente "${edge.to}".`);
    from.outputs.push({ edgeId: edge.id, target });
  }
  return slots;
}

/** Latência do nó: base / (1 - utilização), limitada a LATENCY_CEILING_FACTOR vezes a base. */
function nodeLatencyMs(slot: Slot): number {
  const base = slot.node.spec.baseLatencyMs;
  const ceiling = base * LATENCY_CEILING_FACTOR;
  if (slot.utilization >= 1) return ceiling;
  return Math.min(ceiling, base / (1 - slot.utilization));
}

function bump<TKey, TEntry extends { count: number }>(map: Map<TKey, TEntry>, key: TKey, create: () => TEntry): void {
  const entry = map.get(key);
  if (entry) entry.count += 1;
  else map.set(key, create());
}

class SimulationRun implements Simulation {
  private readonly random: Random;
  private readonly slots: Map<string, Slot>;
  private readonly sources: readonly Slot[];
  private readonly traffic: TrafficState;
  private readonly metrics: MetricsCollector;
  private readonly sloTracker: SloTracker;
  private readonly events: readonly ScheduledEvent[];
  private readonly totalTicks: number;
  private readonly keyspace: number;
  private readonly lastWrites = new Map<number, number>();
  private readonly committedOps = new Set<number>();
  private readonly edgeCutUntilMs = new Map<string, number>();
  private readonly ctx: SimContext;
  private readonly eventCtx: EventContext;
  private tick = 0;
  private nowMs = 0;
  private nextEventIndex = 0;
  private nextRequestId = 0;
  private nextSourceTurn = 0;
  private retries: SimRequest[] = [];
  private flows = new Map<string, { edgeId: string; kind: RequestKind; count: number }>();
  private drops = new Map<string, { nodeId: string; reason: DropReason; count: number }>();

  constructor(private readonly config: SimConfig) {
    const { mix } = config.traffic;
    if (mix.read + mix.write + mix.bot <= 0) throw new Error('Tráfego inválido: o mix precisa somar mais que zero.');

    this.random = mulberry32(config.seed);
    this.slots = buildSlots(config.board);
    this.sources = [...this.slots.values()].filter((slot) => slot.node.type === 'traffic_source');
    if (this.sources.length === 0) throw new Error('Tabuleiro inválido: falta um nó traffic_source.');

    this.traffic = new TrafficState(config.traffic);
    this.metrics = new MetricsCollector(boardCostTier(config.board, config.costBudget));
    this.sloTracker = new SloTracker(config.slos);
    this.events = [...config.events].sort((a, b) => a.atSec - b.atSec);
    this.totalTicks = Math.round(config.durationSec * TICKS_PER_SEC);
    this.keyspace = config.traffic.keyspace ?? DEFAULT_KEYSPACE;
    this.ctx = this.createContext();
    this.eventCtx = this.createEventContext();
  }

  isFinished(): boolean {
    return this.tick >= this.totalTicks;
  }

  step(): TickSnapshot {
    if (this.isFinished()) throw new Error('A simulação já terminou.');
    this.nowMs = this.tick * TICK_MS;
    this.flows = new Map();
    this.drops = new Map();

    this.recoverNodes();
    const firedEvents = this.fireEvents();
    this.refillBudgets();
    this.drainBuffers();
    this.runBehaviorTicks();
    this.injectTraffic();
    this.closeUtilization();

    const timeSec = this.tick / TICKS_PER_SEC;
    const metrics = this.metrics.endTick();
    this.sloTracker.check(metrics, timeSec);
    const snapshot: TickSnapshot = {
      tick: this.tick,
      timeSec,
      metrics,
      nodes: this.snapshotNodes(),
      flows: [...this.flows.values()].map((flow): FlowSnapshot => ({ ...flow })),
      drops: [...this.drops.values()].map((drop): DropSnapshot => ({ ...drop })),
      firedEvents,
    };
    this.tick += 1;
    return snapshot;
  }

  result(): SimResult {
    const violations = this.sloTracker.violations();
    return {
      passed: violations.length === 0,
      metrics: this.metrics.totals(),
      violations,
      firstViolation: violations[0] ?? null,
    };
  }

  private createContext(): SimContext {
    const run = this;
    return {
      get nowMs() {
        return run.nowMs;
      },
      random: this.random,
      lastWriteAtMs: (key) => this.lastWrites.get(key),
      commitWrite: (req) => this.commitWrite(req),
      dispatch: (req, fromNodeId) => this.dispatch(req, fromNodeId),
      addLostWrites: (count) => this.metrics.addLostWrites(count),
    };
  }

  private createEventContext(): EventContext {
    const run = this;
    return {
      get nowMs() {
        return run.nowMs;
      },
      traffic: this.traffic,
      targets: (params) => this.targets(params),
      failNode: (nodeId, untilMs) => this.failNode(nodeId, untilMs),
      cutEdges: (fromId, toId, untilMs) => this.cutEdges(fromId, toId, untilMs),
      notify: (event, nodeId) => {
        const slot = this.slots.get(nodeId);
        if (slot) BEHAVIORS[slot.node.type].onEvent?.(event, slot, this.ctx);
      },
    };
  }

  // --- Fases do tick -------------------------------------------------------

  private recoverNodes(): void {
    for (const slot of this.slots.values()) {
      if (slot.down && this.nowMs >= slot.downUntilMs) slot.down = false;
    }
  }

  private fireEvents(): ScheduledEvent[] {
    const fired: ScheduledEvent[] = [];
    for (;;) {
      const event = this.events[this.nextEventIndex];
      if (!event || event.atSec * 1000 > this.nowMs) return fired;
      EVENT_HANDLERS[event.type](event, this.eventCtx);
      fired.push(event);
      this.nextEventIndex += 1;
    }
  }

  private refillBudgets(): void {
    for (const slot of this.slots.values()) {
      // A capacidade inteira que sobrou não acumula; só a fração passa para o próximo tick.
      slot.budget = (slot.budget % 1) + slot.capacityPerTick;
      slot.demand = slot.buffer.length;
    }
  }

  private drainBuffers(): void {
    for (const slot of this.slots.values()) {
      if (slot.down) continue;
      while (slot.budget >= 1) {
        const pending = slot.buffer.shift();
        if (!pending) break;
        pending.req.latencyMs += this.nowMs - pending.enqueuedAtMs;
        this.process(pending.req, slot);
      }
    }
  }

  private runBehaviorTicks(): void {
    for (const slot of this.slots.values()) {
      if (!slot.down) BEHAVIORS[slot.node.type].onTick?.(slot, this.ctx);
    }
  }

  private injectTraffic(): void {
    const due = this.retries;
    this.retries = [];
    for (const retry of due) {
      const source = this.slots.get(retry.sourceId);
      if (source) this.forward(retry, source);
    }

    const arrivals = this.traffic.arrivalsAt(this.nowMs);
    for (let index = 0; index < arrivals.base; index += 1) this.inject(this.pickKind());
    for (let index = 0; index < arrivals.bots; index += 1) this.inject('bot');
  }

  private closeUtilization(): void {
    for (const slot of this.slots.values()) {
      if (slot.capacityPerTick > 0) slot.utilization = slot.demand / slot.capacityPerTick;
      else slot.utilization = slot.demand > 0 ? 1 : 0;
    }
  }

  private snapshotNodes(): Record<string, NodeSnapshot> {
    const nodes: Record<string, NodeSnapshot> = {};
    for (const [id, slot] of this.slots) {
      const backlog = BEHAVIORS[slot.node.type].backlog?.(slot) ?? 0;
      nodes[id] = { utilization: slot.utilization, queued: slot.buffer.length + backlog, down: slot.down };
    }
    return nodes;
  }

  // --- Caminho de uma requisição ------------------------------------------

  private pickKind(): RequestKind {
    const { mix } = this.config.traffic;
    const roll = this.random() * (mix.read + mix.write + mix.bot);
    if (roll < mix.read) return 'read';
    if (roll < mix.read + mix.write) return 'write';
    return 'bot';
  }

  private inject(kind: RequestKind): void {
    const source = this.sources[this.nextSourceTurn % this.sources.length];
    if (!source) return;
    this.nextSourceTurn += 1;
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    const req: SimRequest = {
      id,
      kind,
      key: Math.floor(this.random() * this.keyspace),
      opId: id,
      bornAtMs: this.nowMs,
      sourceId: source.node.id,
      attempt: 0,
      async: false,
      latencyMs: 0,
      hops: 0,
    };
    this.forward(req, source);
  }

  private isEdgeCut(edgeId: string): boolean {
    const untilMs = this.edgeCutUntilMs.get(edgeId);
    return untilMs !== undefined && this.nowMs < untilMs;
  }

  private readonly blockedBy = (link: OutputLink<Slot>): DropReason | null => {
    if (link.target.down) return 'node_down';
    if (this.isEdgeCut(link.edgeId)) return 'partitioned';
    return null;
  };

  /** Além de no ar e alcançável, o alvo precisa ter folga agora (sem enfileirar). */
  private readonly blockedForDispatch = (link: OutputLink<Slot>): DropReason | null => {
    const blocked = this.blockedBy(link);
    if (blocked) return blocked;
    return link.target.buffer.length > 0 || link.target.budget < 1 ? 'saturated' : null;
  };

  private forward(req: SimRequest, from: Slot): void {
    req.hops += 1;
    if (req.hops > MAX_HOPS) {
      this.fail(req, 'no_route', from.node.id);
      return;
    }
    const route = chooseRoute(req, from.outputs, from.cursor, this.blockedBy);
    if (!route.ok) {
      this.fail(req, route.reason, from.node.id);
      return;
    }
    this.countFlow(route.link.edgeId, req.kind);
    this.arrive(req, route.link.target);
  }

  private dispatch(req: SimRequest, fromNodeId: string): boolean {
    const from = this.slots.get(fromNodeId);
    if (!from) return false;
    const route = chooseRoute(req, from.outputs, from.cursor, this.blockedForDispatch);
    if (!route.ok) return false;
    this.countFlow(route.link.edgeId, req.kind);
    route.link.target.demand += 1;
    this.process(req, route.link.target);
    return true;
  }

  private arrive(req: SimRequest, slot: Slot): void {
    slot.demand += 1;
    const hasRoomNow = slot.buffer.length === 0 && slot.budget >= 1;
    if (hasRoomNow) {
      this.process(req, slot);
      return;
    }
    if (slot.buffer.length < slot.node.spec.bufferSize) {
      slot.buffer.push({ req, enqueuedAtMs: this.nowMs });
      return;
    }
    this.fail(req, 'saturated', slot.node.id);
  }

  private process(req: SimRequest, slot: Slot): void {
    slot.budget -= 1;
    req.latencyMs += nodeLatencyMs(slot);
    const decision = BEHAVIORS[slot.node.type].handle(req, slot, this.ctx);
    switch (decision.action) {
      case 'forward':
        this.forward(req, slot);
        return;
      case 'respond':
        this.complete(req, decision.stale === true);
        return;
      case 'ack':
        this.complete(req, false);
        return;
      case 'drop':
        this.fail(req, decision.reason, slot.node.id);
        return;
    }
  }

  private complete(req: SimRequest, stale: boolean): void {
    if (req.async || req.kind === 'bot') return;
    this.metrics.recordOk(req.latencyMs);
    if (stale && req.kind === 'read') this.metrics.addStaleRead();

    const policy = this.traffic.retryPolicyAt(this.nowMs);
    const timedOut = policy !== null && req.latencyMs > policy.timeoutMs;
    if (timedOut && req.attempt < policy.maxRetries) this.scheduleRetry(req);
  }

  private fail(req: SimRequest, reason: DropReason, nodeId: string): void {
    bump(this.drops, `${nodeId}|${reason}`, () => ({ nodeId, reason, count: 1 }));
    if (req.async) {
      this.metrics.addLostWrites(1);
      return;
    }
    if (req.kind === 'bot') return;

    this.metrics.recordError();
    const policy = this.traffic.retryPolicyAt(this.nowMs);
    if (policy !== null && req.attempt < policy.maxRetries) {
      this.scheduleRetry(req);
      return;
    }
    if (req.kind === 'write') this.metrics.addLostWrites(1);
  }

  /** O cliente reenvia no tick seguinte, com o mesmo opId. */
  private scheduleRetry(req: SimRequest): void {
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    this.retries.push({ ...req, id, attempt: req.attempt + 1, latencyMs: 0, hops: 0 });
  }

  private commitWrite(req: SimRequest): void {
    if (this.committedOps.has(req.opId)) this.metrics.addDuplicateOp();
    else this.committedOps.add(req.opId);
    this.lastWrites.set(req.key, this.nowMs);
  }

  private countFlow(edgeId: string, kind: RequestKind): void {
    bump(this.flows, `${edgeId}|${kind}`, () => ({ edgeId, kind, count: 1 }));
  }

  // --- Alavancas dos eventos ----------------------------------------------

  private targets(params: EventParams): Slot[] {
    const { nodeId, nodeType, count } = params;
    if (typeof nodeId === 'string') {
      const slot = this.slots.get(nodeId);
      return slot ? [slot] : [];
    }
    if (typeof nodeType === 'string') {
      const limit = typeof count === 'number' ? count : 1;
      return [...this.slots.values()].filter((slot) => slot.node.type === nodeType).slice(0, limit);
    }
    throw new Error('Evento sem alvo: informe "nodeId" ou "nodeType".');
  }

  private failNode(nodeId: string, untilMs: number): void {
    const slot = this.slots.get(nodeId);
    if (!slot) return;
    // Uma falha nova nunca encurta outra que já está em curso.
    slot.downUntilMs = slot.down ? Math.max(slot.downUntilMs, untilMs) : untilMs;
    slot.down = true;
    const lost = slot.buffer;
    slot.buffer = [];
    for (const pending of lost) this.fail(pending.req, 'node_down', nodeId);
  }

  private cutEdges(fromId: string, toId: string, untilMs: number): void {
    for (const edge of this.config.board.edges) {
      const connects = (edge.from === fromId && edge.to === toId) || (edge.from === toId && edge.to === fromId);
      if (connects) this.edgeCutUntilMs.set(edge.id, untilMs);
    }
  }
}

export function createSimulation(config: SimConfig): Simulation {
  return new SimulationRun(config);
}

/** Roda a partida inteira sem UI. */
export function runToEnd(config: SimConfig): SimResult {
  const simulation = createSimulation(config);
  while (!simulation.isFinished()) simulation.step();
  return simulation.result();
}
