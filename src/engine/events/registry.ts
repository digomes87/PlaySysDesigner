import type { EventHandler, SimEventType } from '../types';
import { botWave } from './botWave';
import { cacheFlush } from './cacheFlush';
import { clientRetry } from './clientRetry';
import { diskFailure } from './diskFailure';
import { networkPartition } from './networkPartition';
import { nodeFailure } from './nodeFailure';
import { trafficRamp } from './trafficRamp';
import { trafficSpike } from './trafficSpike';

/** Mapa tipo -> handler. Evento novo sem handler aqui não compila. */
export const EVENT_HANDLERS: { readonly [TType in SimEventType]: EventHandler } = {
  traffic_ramp: trafficRamp,
  traffic_spike: trafficSpike,
  bot_wave: botWave,
  node_failure: nodeFailure,
  network_partition: networkPartition,
  client_retry: clientRetry,
  disk_failure: diskFailure,
  cache_flush: cacheFlush,
};
