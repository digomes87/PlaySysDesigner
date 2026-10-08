import {
  AVAILABILITY_ERROR_THRESHOLD,
  SLO_MIN_SAMPLES,
  SLO_WINDOW_SEC,
  TICKS_PER_SEC,
  type CostTier,
  type Metrics,
} from './types';

const MAX_LATENCY_MS = 60_000;
const WINDOW_TICKS = SLO_WINDOW_SEC * TICKS_PER_SEC;

/** Histograma com resolução de 1 ms: percentil barato e amostras removíveis (janela deslizante). */
export class LatencyHistogram {
  private readonly counts = new Int32Array(MAX_LATENCY_MS + 1);
  private total = 0;
  private highest = 0;

  /** `count` negativo remove amostras. */
  add(latencyMs: number, count: number): void {
    const bucket = Math.min(MAX_LATENCY_MS, Math.max(0, Math.round(latencyMs)));
    this.counts[bucket] = (this.counts[bucket] ?? 0) + count;
    this.total += count;
    if (bucket > this.highest) this.highest = bucket;
  }

  percentile(fraction: number): number {
    if (this.total <= 0) return 0;
    const target = Math.ceil(this.total * fraction);
    let seen = 0;
    for (let bucket = 0; bucket <= this.highest; bucket += 1) {
      seen += this.counts[bucket] ?? 0;
      if (seen >= target) return bucket;
    }
    return this.highest;
  }
}

interface TickSample {
  readonly ok: number;
  readonly errors: number;
  readonly latencies: ReadonlyMap<number, number>;
}

function ratio(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}

/**
 * Acumula o placar. p99 e errorRate existem em duas versões: da janela deslizante
 * (usada para SLO, devolvida por `endTick`) e da partida inteira (`totals`).
 */
export class MetricsCollector {
  private readonly totalLatency = new LatencyHistogram();
  private readonly windowLatency = new LatencyHistogram();
  private readonly window: TickSample[] = [];
  private tickLatencies = new Map<number, number>();
  private tickOk = 0;
  private tickErrors = 0;
  private windowOk = 0;
  private windowErrors = 0;
  private totalOk = 0;
  private totalErrors = 0;
  private secondOk = 0;
  private secondErrors = 0;
  private ticksInSecond = 0;
  private seconds = 0;
  private goodSeconds = 0;
  private staleReads = 0;
  private duplicateOps = 0;
  private lostWrites = 0;

  constructor(private readonly costTier: CostTier) {}

  recordOk(latencyMs: number): void {
    const rounded = Math.round(latencyMs);
    this.tickLatencies.set(rounded, (this.tickLatencies.get(rounded) ?? 0) + 1);
    this.tickOk += 1;
  }

  recordError(): void {
    this.tickErrors += 1;
  }

  addStaleRead(): void {
    this.staleReads += 1;
  }

  addDuplicateOp(): void {
    this.duplicateOps += 1;
  }

  addLostWrites(count: number): void {
    this.lostWrites += count;
  }

  /**
   * Fecha o tick e devolve as métricas com p99/errorRate da janela corrente.
   * Com menos de SLO_MIN_SAMPLES respostas na janela, os dois saem zerados.
   */
  endTick(): Metrics {
    const sample: TickSample = { ok: this.tickOk, errors: this.tickErrors, latencies: this.tickLatencies };
    this.pushSample(sample);
    this.closeSecondIfDue(sample);
    this.tickLatencies = new Map();
    this.tickOk = 0;
    this.tickErrors = 0;
    const answered = this.windowOk + this.windowErrors;
    if (answered < SLO_MIN_SAMPLES) return this.build(0, 0);
    return this.build(this.windowLatency.percentile(0.99), ratio(this.windowErrors, answered));
  }

  totals(): Metrics {
    return this.build(this.totalLatency.percentile(0.99), ratio(this.totalErrors, this.totalOk + this.totalErrors));
  }

  private pushSample(sample: TickSample): void {
    this.window.push(sample);
    this.windowOk += sample.ok;
    this.windowErrors += sample.errors;
    this.totalOk += sample.ok;
    this.totalErrors += sample.errors;
    for (const [latencyMs, count] of sample.latencies) {
      this.windowLatency.add(latencyMs, count);
      this.totalLatency.add(latencyMs, count);
    }
    if (this.window.length <= WINDOW_TICKS) return;
    const expired = this.window.shift();
    if (!expired) return;
    this.windowOk -= expired.ok;
    this.windowErrors -= expired.errors;
    for (const [latencyMs, count] of expired.latencies) this.windowLatency.add(latencyMs, -count);
  }

  private closeSecondIfDue(sample: TickSample): void {
    this.secondOk += sample.ok;
    this.secondErrors += sample.errors;
    this.ticksInSecond += 1;
    if (this.ticksInSecond < TICKS_PER_SEC) return;
    const answered = this.secondOk + this.secondErrors;
    if (answered > 0) {
      this.seconds += 1;
      if (this.secondErrors / answered <= AVAILABILITY_ERROR_THRESHOLD) this.goodSeconds += 1;
    }
    this.secondOk = 0;
    this.secondErrors = 0;
    this.ticksInSecond = 0;
  }

  private build(p99LatencyMs: number, errorRate: number): Metrics {
    return {
      p99LatencyMs,
      errorRate,
      availability: this.seconds === 0 ? 1 : this.goodSeconds / this.seconds,
      costTier: this.costTier,
      staleReads: this.staleReads,
      duplicateOps: this.duplicateOps,
      lostWrites: this.lostWrites,
    };
  }
}
