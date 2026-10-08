import { COST_TIERS, type CostTier, type Metrics, type Slo, type SloViolation } from './types';

function rank(value: number | CostTier): number {
  return typeof value === 'number' ? value : COST_TIERS.indexOf(value);
}

export function sloHolds(slo: Slo, metrics: Metrics): boolean {
  const observed = rank(metrics[slo.metric]);
  const limit = rank(slo.value);
  return slo.op === 'lte' ? observed <= limit : observed >= limit;
}

/** Guarda a primeira violação de cada SLO ao longo da partida. */
export class SloTracker {
  private readonly violated = new Map<number, SloViolation>();

  constructor(private readonly slos: readonly Slo[]) {}

  check(metrics: Metrics, timeSec: number): void {
    this.slos.forEach((slo, index) => {
      if (this.violated.has(index) || sloHolds(slo, metrics)) return;
      this.violated.set(index, { metric: slo.metric, atSec: timeSec, observed: metrics[slo.metric] });
    });
  }

  /** Em ordem cronológica; empate segue a ordem em que os SLOs foram declarados. */
  violations(): SloViolation[] {
    return [...this.violated.entries()]
      .sort(([indexA, a], [indexB, b]) => a.atSec - b.atSec || indexA - indexB)
      .map(([, violation]) => violation);
  }
}
