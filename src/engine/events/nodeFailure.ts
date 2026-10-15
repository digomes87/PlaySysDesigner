import type { EventHandler } from '../types';
import { effectEndMs } from './params';

/** Takes the target nodes down for `durationSec`; whatever was in their buffer is lost. */
export const nodeFailure: EventHandler = (event, ctx) => {
  const untilMs = effectEndMs(event, ctx.nowMs);
  for (const target of ctx.targets(event.params)) ctx.failNode(target.node.id, untilMs);
};
