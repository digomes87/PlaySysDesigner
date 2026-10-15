import type { EventHandler } from '../types';

/** Empties the target caches (all of them if the event names none); they warm up over `warmupSec`. */
export const cacheFlush: EventHandler = (event, ctx) => {
  const hasTarget = event.params.nodeId !== undefined || event.params.nodeType !== undefined;
  const params = hasTarget ? event.params : { nodeType: 'cache', count: Number.MAX_SAFE_INTEGER };
  for (const target of ctx.targets(params)) ctx.notify(event, target.node.id);
};
