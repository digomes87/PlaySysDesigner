import type { EventHandler } from '../types';
import { effectEndMs } from './params';

/**
 * Disk failure: besides going down for `durationSec`, the node loses what it held.
 * Exactly what is lost is up to the component's behaviour.
 */
export const diskFailure: EventHandler = (event, ctx) => {
  const untilMs = effectEndMs(event, ctx.nowMs);
  for (const target of ctx.targets(event.params)) {
    ctx.notify(event, target.node.id);
    ctx.failNode(target.node.id, untilMs);
  }
};
