import type { EventHandler } from '../types';
import { effectEndMs, optionalNumber, requireNumber } from './params';

/**
 * Liga o retry do cliente: requisição que falha, ou que demora mais que
 * `timeoutMs`, é reenviada com o mesmo opId até `maxRetries` vezes.
 */
export const clientRetry: EventHandler = (event, ctx) => {
  const policy = {
    timeoutMs: requireNumber(event, 'timeoutMs'),
    maxRetries: optionalNumber(event, 'maxRetries', 1),
  };
  ctx.traffic.setRetryPolicy(policy, effectEndMs(event, ctx.nowMs));
};
