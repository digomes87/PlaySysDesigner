import type { EventHandler } from '../types';

/** Esvazia os caches alvo (todos, se o evento não disser quais); eles reaquecem em `warmupSec`. */
export const cacheFlush: EventHandler = (event, ctx) => {
  const hasTarget = event.params.nodeId !== undefined || event.params.nodeType !== undefined;
  const params = hasTarget ? event.params : { nodeType: 'cache', count: Number.MAX_SAFE_INTEGER };
  for (const target of ctx.targets(params)) ctx.notify(event, target.node.id);
};
