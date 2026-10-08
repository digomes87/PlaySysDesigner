import type { ComponentBehavior } from '../types';
import { NO_PRIORITY } from './shared';

/** Origem do tráfego: o núcleo injeta as requisições a partir dela; nunca recebe nada. */
export const trafficSource: ComponentBehavior<null> = {
  priority: NO_PRIORITY,
  createState: () => null,
  accepts: () => false,
  handle: () => ({ action: 'forward' }),
};
