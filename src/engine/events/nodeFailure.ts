import type { EventHandler } from '../types';
import { effectEndMs } from './params';

/** Tira do ar os nós alvo durante `durationSec`; o que estava no buffer deles se perde. */
export const nodeFailure: EventHandler = (event, ctx) => {
  const untilMs = effectEndMs(event, ctx.nowMs);
  for (const target of ctx.targets(event.params)) ctx.failNode(target.node.id, untilMs);
};
