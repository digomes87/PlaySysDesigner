import type { ComponentBehavior } from '../types';
import { PRIORITY } from './shared';

/**
 * Consumes queue jobs at `capacityRps` and takes them to the database.
 * Receives only asynchronous work: direct client traffic is never routed here.
 */
export const worker: ComponentBehavior<null> = {
  priority: { read: 0, write: PRIORITY.worker, bot: 0 },
  createState: () => null,
  accepts: (req) => req.async && req.kind === 'write',
  handle: () => ({ action: 'forward' }),
};
