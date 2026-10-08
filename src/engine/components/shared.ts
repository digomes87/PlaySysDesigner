import type { ComponentBehavior, RequestKind } from '../types';

export type Priority = Readonly<Record<RequestKind, number>>;

export const NO_PRIORITY: Priority = { read: 0, write: 0, bot: 0 };

/**
 * Prioridades de roteamento. Camadas de passagem ficam acima dos dados; nos dados,
 * leitura prefere cache > réplica > primário e escrita prefere fila > primário.
 */
export const PRIORITY = {
  rateLimiter: 90,
  loadBalancer: 80,
  appServer: 70,
  cache: 60,
  replica: 50,
  queue: 40,
  primary: 10,
  worker: 5,
} as const;

export function samePriority(value: number): Priority {
  return { read: value, write: value, bot: value };
}

/** Componente sem estado que só repassa o tráfego síncrono adiante. */
export function passThrough(priority: Priority): ComponentBehavior<null> {
  return {
    priority,
    createState: () => null,
    accepts: (req) => !req.async && priority[req.kind] > 0,
    handle: () => ({ action: 'forward' }),
  };
}
