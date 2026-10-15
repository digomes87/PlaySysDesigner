import type { EventHandler } from '../types';
import { effectEndMs, optionalNumber, requireNumber } from './params';

/**
 * Turns on client retries: a request that fails, or takes longer than
 * `timeoutMs`, is resent with the same opId up to `maxRetries` times.
 */
export const clientRetry: EventHandler = (event, ctx) => {
  const policy = {
    timeoutMs: requireNumber(event, 'timeoutMs'),
    maxRetries: optionalNumber(event, 'maxRetries', 1),
  };
  ctx.traffic.setRetryPolicy(policy, effectEndMs(event, ctx.nowMs));
};
