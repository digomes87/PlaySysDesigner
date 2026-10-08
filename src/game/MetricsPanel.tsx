import type { Level } from '../content/schema';
import { REQUEST_KINDS, type CostTier, type MetricId, type Slo } from '../engine/types';
import type { I18n } from '../i18n/useI18n';
import { useI18n } from '../i18n/useI18n';
import { useRunStore } from './runStore';

const RATIO_METRICS: readonly MetricId[] = ['errorRate', 'availability'];

function formatValue(metric: MetricId, value: number | CostTier, i18n: I18n): string {
  if (typeof value === 'string') return i18n.m.metrics.tiers[value];
  if (metric === 'p99LatencyMs') return `${i18n.number(value)} ms`;
  if (RATIO_METRICS.includes(metric)) return i18n.percent(value, 2);
  return i18n.number(value);
}

function formatLimit(slo: Slo, i18n: I18n): string {
  const value = formatValue(slo.metric, slo.value, i18n);
  return slo.op === 'lte' ? i18n.m.metrics.atMost(value) : i18n.m.metrics.atLeast(value);
}

/** Quanto do limite já foi consumido, de 0 a 1; null quando não faz sentido como barra. */
function consumed(slo: Slo, value: number | CostTier | undefined): number | null {
  if (typeof value !== 'number' || typeof slo.value !== 'number' || slo.op !== 'lte') return null;
  if (slo.value === 0) return value > 0 ? 1 : 0;
  return Math.min(1, value / slo.value);
}

/** Placar: um bloco por SLO da fase, com valor ao vivo, limite e estado. */
export function MetricsPanel({ level }: { readonly level: Level }) {
  const i18n = useI18n();
  const { m } = i18n;
  const metrics = useRunStore((state) => state.snapshot?.metrics);
  const violations = useRunStore((state) => state.violations);

  return (
    <section className="scoreboard panel" aria-labelledby="scoreboard-title">
      <h2 id="scoreboard-title" className="eyebrow">
        {m.metrics.title}
      </h2>
      <ul className="scoreboard__list">
        {level.slos.map((slo) => {
          const value = metrics?.[slo.metric];
          const violation = violations.find((entry) => entry.metric === slo.metric);
          const fill = consumed(slo, violation ? violation.observed : value);
          const state = violation ? 'violated' : value === undefined ? 'pending' : 'ok';
          return (
            <li key={slo.metric} className={`stat stat--${state}`}>
              <p className="stat__name">{m.metrics.names[slo.metric]}</p>
              <p className="stat__value mono">{value === undefined ? '—' : formatValue(slo.metric, value, i18n)}</p>
              {fill !== null && (
                <div className="stat__meter" aria-hidden="true">
                  <span style={{ transform: `scaleX(${fill})` }} />
                </div>
              )}
              <p className="stat__limit">
                {m.metrics.limit}: <span className="mono">{formatLimit(slo, i18n)}</span>
              </p>
              {state !== 'pending' && (
                <p className="stat__status">
                  {violation
                    ? `✕ ${m.metrics.violatedAt(i18n.number(violation.atSec, 1))} · ${formatValue(slo.metric, violation.observed, i18n)}`
                    : `✓ ${m.metrics.ok}`}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <div className="legend">
        <p className="eyebrow">{m.play.legend}</p>
        <ul>
          {REQUEST_KINDS.map((kind) => (
            <li key={kind}>
              <span className={`legend__swatch legend__swatch--${kind}`} aria-hidden="true" />
              {m.kinds[kind]}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
