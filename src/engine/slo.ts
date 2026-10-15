import { COST_TIERS, type CostTier, type Metrics, type Slo, type SloViolation } from './types';

function rank(value: number | CostTier): number {
  return typeof value === 'number' ? value : COST_TIERS.indexOf(value);
}

export function sloHolds(slo: Slo, metrics: Metrics): boolean {
  const observed = rank(metrics[slo.metric]);
  const limit = rank(slo.value);
  return slo.op === 'lte' ? observed <= limit : observed >= limit;
}

/** Keeps the first violation of each SLO over the run. */
export class SloTracker {
  private readonly violated = new Map<number, SloViolation>();

  constructor(private readonly slos: readonly Slo[]) {}

  check(metrics: Metrics, timeSec: number): void {
    this.slos.forEach((slo, index) => {
      if (this.violated.has(index) || sloHolds(slo, metrics)) return;
      this.violated.set(index, { metric: slo.metric, atSec: timeSec, observed: metrics[slo.metric] });
    });
  }

  /** In chronological order; ties follow the order the SLOs were declared in. */
  violations(): SloViolation[] {
    return [...this.violated.entries()]
      .sort(([indexA, a], [indexB, b]) => a.atSec - b.atSec || indexA - indexB)
      .map(([, violation]) => violation);
  }
}
