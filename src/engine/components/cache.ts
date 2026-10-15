import type { ComponentBehavior } from '../types';
import { PRIORITY } from './shared';

const DEFAULT_WARMUP_SEC = 10;

interface CacheState {
  /** When each key was last fetched from the database. */
  readonly filledAtMs: Map<number, number>;
  flushedAtMs: number;
  warmupMs: number;
}

/** After a flush the cache warms up linearly to the configured hitRate. */
function effectiveHitRate(hitRate: number, state: CacheState, nowMs: number): number {
  const sinceFlushMs = nowMs - state.flushedAtMs;
  // Without warm-up the cache is still empty on the flush tick.
  if (state.warmupMs <= 0) return sinceFlushMs > 0 ? hitRate : 0;
  return hitRate * Math.min(1, sinceFlushMs / state.warmupMs);
}

/**
 * Answers reads with probability `hitRate`; a miss goes on to the database.
 * A write to the same key invalidates the entry, so the cache never returns stale
 * data in the MVP. Bots sweep cold keys and always miss the cache.
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
