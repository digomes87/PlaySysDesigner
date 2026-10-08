import { TICKS_PER_SEC, type ComponentBehavior } from '../types';
import { PRIORITY, samePriority } from './shared';

interface RateLimiterState {
  /** Bots que ainda podem passar neste tick. */
  tokens: number;
}

const priority = samePriority(PRIORITY.rateLimiter);

/**
 * Deixa passar até `limitRps` de bots e descarta o excedente. No MVP a
 * identificação é perfeita: tráfego legítimo nunca é barrado.
 */
export const rateLimiter: ComponentBehavior<RateLimiterState> = {
  priority,
  createState: () => ({ tokens: 0 }),
  accepts: (req) => !req.async,
  onTick(node) {
    const perTick = (node.node.spec.params.limitRps ?? 0) / TICKS_PER_SEC;
    node.state.tokens = (node.state.tokens % 1) + perTick;
  },
  handle(req, node) {
    if (req.kind !== 'bot') return { action: 'forward' };
    if (node.state.tokens < 1) return { action: 'drop', reason: 'rate_limited' };
    node.state.tokens -= 1;
    return { action: 'forward' };
  },
};
