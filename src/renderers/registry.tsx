import type { ReactNode } from 'react';
import type { ComponentSpec, ComponentType } from '../engine/types';
import type { Messages } from '../i18n/messages.pt-BR';

export interface ComponentRenderer {
  /** Desenho do tipo, num viewBox 24x24, só traço (herda `currentColor`). */
  readonly glyph: ReactNode;
  /** Números da peça que importam para decidir: capacidade, lag, acerto... */
  specLines(spec: ComponentSpec, m: Messages): string[];
  readonly hasInput: boolean;
  readonly hasOutput: boolean;
}

const capacity = (spec: ComponentSpec, m: Messages): string[] => [m.specs.rps(spec.capacityRps)];

/**
 * Mapa tipo -> renderer. O tipo mapeado obriga a registrar um renderer para cada
 * ComponentType: esquecer um tipo novo aqui é erro de compilação.
 */
export const RENDERERS: { readonly [TType in ComponentType]: ComponentRenderer } = {
  traffic_source: {
    glyph: (
      <>
        <circle cx="12" cy="8" r="3.2" />
        <path d="M5 20c.6-3.8 3.4-6 7-6s6.4 2.2 7 6" />
      </>
    ),
    specLines: () => [],
    hasInput: false,
    hasOutput: true,
  },
  load_balancer: {
    glyph: (
      <>
        <path d="M3 12h6" />
        <path d="M9 12l6-7h6M9 12h12M9 12l6 7h6" />
      </>
    ),
    specLines: () => [],
    hasInput: true,
    hasOutput: true,
  },
  app_server: {
    glyph: (
      <>
        <rect x="4" y="4" width="16" height="7" rx="1.5" />
        <rect x="4" y="13" width="16" height="7" rx="1.5" />
        <path d="M7.5 7.5h.01M7.5 16.5h.01" />
      </>
    ),
    specLines: capacity,
    hasInput: true,
    hasOutput: true,
  },
  cache: {
    glyph: <path d="M13 3L5 13.5h6L10 21l9-11h-6.5L13 3z" />,
    specLines: (spec, m) => [m.specs.hitRate(Math.round((spec.params.hitRate ?? 0) * 100))],
    hasInput: true,
    hasOutput: true,
  },
  db_primary: {
    glyph: (
      <>
        <ellipse cx="12" cy="6" rx="7" ry="2.8" />
        <path d="M5 6v12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8" />
      </>
    ),
    specLines: capacity,
    hasInput: true,
    hasOutput: false,
  },
  db_replica: {
    glyph: (
      <>
        <ellipse cx="12" cy="6" rx="7" ry="2.8" strokeDasharray="2.5 2" />
        <path d="M5 6v12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6" />
        <path d="M9 14.5l2.2 2.2L15.5 12" />
      </>
    ),
    specLines: (spec, m) => [m.specs.rps(spec.capacityRps), m.specs.lag(spec.params.replicationLagMs ?? 0)],
    hasInput: true,
    hasOutput: false,
  },
  queue: {
    glyph: (
      <>
        <rect x="3" y="7" width="4" height="10" rx="1" />
        <rect x="9" y="7" width="4" height="10" rx="1" />
        <rect x="15" y="7" width="4" height="10" rx="1" />
        <path d="M20.5 12h1" />
      </>
    ),
    specLines: () => [],
    hasInput: true,
    hasOutput: true,
  },
  worker: {
    glyph: (
      <>
        <circle cx="12" cy="12" r="3.2" />
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
      </>
    ),
    specLines: capacity,
    hasInput: true,
    hasOutput: true,
  },
  rate_limiter: {
    glyph: (
      <>
        <path d="M4 5h16l-6 7v6l-4 2v-8L4 5z" />
      </>
    ),
    specLines: (spec, m) => [m.specs.limit(spec.params.limitRps ?? 0)],
    hasInput: true,
    hasOutput: true,
  },
};

export function ComponentGlyph({ type, size = 20 }: { readonly type: ComponentType; readonly size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {RENDERERS[type].glyph}
    </svg>
  );
}
