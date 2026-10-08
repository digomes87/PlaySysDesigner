import type { ComponentBehavior } from '../types';
import { PRIORITY } from './shared';

/**
 * Consome trabalhos da fila no ritmo de `capacityRps` e os leva ao banco.
 * Só recebe trabalho assíncrono: tráfego direto do cliente nunca é roteado para cá.
 */
export const worker: ComponentBehavior<null> = {
  priority: { read: 0, write: PRIORITY.worker, bot: 0 },
  createState: () => null,
  accepts: (req) => req.async && req.kind === 'write',
  handle: () => ({ action: 'forward' }),
};
