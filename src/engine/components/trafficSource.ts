import type { ComponentBehavior } from '../types';
import { NO_PRIORITY } from './shared';

/** Traffic source: the core injects requests from it; it never receives anything. */
export const trafficSource: ComponentBehavior<null> = {
  priority: NO_PRIORITY,
  createState: () => null,
  accepts: () => false,
  handle: () => ({ action: 'forward' }),
};
