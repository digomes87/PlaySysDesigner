import type { ComponentBehavior } from '../types';
import { PRIORITY } from './shared';

const DEFAULT_WARMUP_SEC = 10;

interface CacheState {
  /** Quando cada chave foi buscada no banco pela última vez. */
  readonly filledAtMs: Map<number, number>;
  flushedAtMs: number;
  warmupMs: number;
}

/** Depois de um flush o cache reaquece de forma linear até o hitRate configurado. */
function effectiveHitRate(hitRate: number, state: CacheState, nowMs: number): number {
  const sinceFlushMs = nowMs - state.flushedAtMs;
  // Sem aquecimento o cache ainda fica vazio no tick do flush.
  if (state.warmupMs <= 0) return sinceFlushMs > 0 ? hitRate : 0;
  return hitRate * Math.min(1, sinceFlushMs / state.warmupMs);
}

/**
 * Responde leituras com probabilidade `hitRate`; o miss segue para o banco.
 * Escrita na mesma chave invalida a entrada, então o cache nunca devolve dado
 * velho no MVP. Bots varrem chaves frias e sempre furam o cache.
 */
export const cache: ComponentBehavior<CacheState> = {
  priority: { read: PRIORITY.cache, write: 0, bot: PRIORITY.cache },
  createState: () => ({ filledAtMs: new Map(), flushedAtMs: Number.NEGATIVE_INFINITY, warmupMs: 0 }),
  accepts: (req) => !req.async && req.kind !== 'write',
  handle(req, node, ctx) {
    if (req.kind === 'bot') return { action: 'forward' };

    const { state } = node;
    const lastWriteAtMs = ctx.lastWriteAtMs(req.key);
    const filledAtMs = state.filledAtMs.get(req.key) ?? Number.NEGATIVE_INFINITY;
    const isInvalidated = lastWriteAtMs !== undefined && lastWriteAtMs >= filledAtMs;
    const hitRate = effectiveHitRate(node.node.spec.params.hitRate ?? 0, state, ctx.nowMs);
    if (!isInvalidated && ctx.random() < hitRate) return { action: 'respond' };

    state.filledAtMs.set(req.key, ctx.nowMs);
    return { action: 'forward' };
  },
  onEvent(event, node, ctx) {
    if (event.type !== 'cache_flush') return;
    const warmupSec = event.params.warmupSec;
    node.state.flushedAtMs = ctx.nowMs;
    node.state.warmupMs = (typeof warmupSec === 'number' ? warmupSec : DEFAULT_WARMUP_SEC) * 1000;
  },
};
