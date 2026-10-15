import { TICKS_PER_SEC, type ComponentBehavior } from '../types';
import { PRIORITY, samePriority } from './shared';

interface RateLimiterState {
  /** Bots that may still pass this tick. */
  tokens: number;
}

const priority = samePriority(PRIORITY.rateLimiter);

/**
 * Lets up to `limitRps` of bots through and drops the excess. In the MVP
 * detection is perfect: legitimate traffic is never blocked.
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
