import { TICKS_PER_SEC, type RetryPolicy, type TrafficConfig, type TrafficControl } from './types';

interface Ramp {
  readonly fromRps: number;
  readonly toRps: number;
  readonly startMs: number;
  readonly endMs: number;
}

interface Timed<T> {
  readonly value: T;
  readonly untilMs: number;
}

export interface TickArrivals {
  /** Requisições do tráfego base neste tick; o tipo de cada uma sai do mix. */
  readonly base: number;
  /** Bots extras de ondas ativas. */
  readonly bots: number;
}

function isActive(entry: Timed<unknown>, nowMs: number): boolean {
  return nowMs < entry.untilMs;
}

/** Estado do tráfego: taxa base, rampa, picos, ondas de bot e política de retry. */
export class TrafficState implements TrafficControl {
  private baseRps: number;
  private ramp: Ramp | null = null;
  private multipliers: Timed<number>[] = [];
  private botWaves: Timed<number>[] = [];
  private retry: Timed<RetryPolicy> | null = null;
  private baseCarry = 0;
  private botCarry = 0;

  constructor(config: TrafficConfig) {
    this.baseRps = config.baseRps;
  }

  startRamp(toRps: number, nowMs: number, durationMs: number): void {
    this.ramp = { fromRps: this.currentBaseRps(nowMs), toRps, startMs: nowMs, endMs: nowMs + durationMs };
  }

  addMultiplier(factor: number, untilMs: number): void {
    this.multipliers = [...this.multipliers, { value: factor, untilMs }];
  }

  addBotWave(rps: number, untilMs: number): void {
    this.botWaves = [...this.botWaves, { value: rps, untilMs }];
  }

  setRetryPolicy(policy: RetryPolicy, untilMs: number): void {
    this.retry = { value: policy, untilMs };
  }

  retryPolicyAt(nowMs: number): RetryPolicy | null {
    return this.retry && isActive(this.retry, nowMs) ? this.retry.value : null;
  }

  /** Quantas requisições nascem neste tick. Frações acumulam para o tick seguinte. */
  arrivalsAt(nowMs: number): TickArrivals {
    this.multipliers = this.multipliers.filter((entry) => isActive(entry, nowMs));
    this.botWaves = this.botWaves.filter((entry) => isActive(entry, nowMs));
    const multiplier = this.multipliers.reduce((product, entry) => product * entry.value, 1);
    const botRps = this.botWaves.reduce((sum, entry) => sum + entry.value, 0);

    // O acumulado fica em "requisições por segundo": taxa inteira não sofre erro de ponto flutuante.
    this.baseCarry += this.currentBaseRps(nowMs) * multiplier;
    this.botCarry += botRps;
    const base = Math.floor(this.baseCarry / TICKS_PER_SEC);
    const bots = Math.floor(this.botCarry / TICKS_PER_SEC);
    this.baseCarry -= base * TICKS_PER_SEC;
    this.botCarry -= bots * TICKS_PER_SEC;
    return { base, bots };
  }

  private currentBaseRps(nowMs: number): number {
    const ramp = this.ramp;
    if (!ramp) return this.baseRps;
    if (nowMs >= ramp.endMs) {
      this.baseRps = ramp.toRps;
      this.ramp = null;
      return this.baseRps;
    }
    const progress = (nowMs - ramp.startMs) / (ramp.endMs - ramp.startMs);
    return ramp.fromRps + (ramp.toRps - ramp.fromRps) * progress;
  }
}
