import type { ComponentBehavior, ComponentType } from '../types';
import { appServer } from './appServer';
import { cache } from './cache';
import { dbPrimary } from './dbPrimary';
import { dbReplica } from './dbReplica';
import { loadBalancer } from './loadBalancer';
import { queue } from './queue';
import { rateLimiter } from './rateLimiter';
import { trafficSource } from './trafficSource';
import { worker } from './worker';

/**
 * Mapa tipo -> comportamento. O tipo mapeado obriga a registrar um comportamento
 * para cada ComponentType: esquecer um tipo novo aqui é erro de compilação.
 */
export const BEHAVIORS: { readonly [TType in ComponentType]: ComponentBehavior } = {
  traffic_source: trafficSource,
  load_balancer: loadBalancer,
  app_server: appServer,
  cache,
  db_primary: dbPrimary,
  db_replica: dbReplica,
  queue,
  worker,
  rate_limiter: rateLimiter,
};
