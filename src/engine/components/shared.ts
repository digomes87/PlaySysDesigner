import type { ComponentBehavior, RequestKind } from '../types';

export type Priority = Readonly<Record<RequestKind, number>>;

export const NO_PRIORITY: Priority = { read: 0, write: 0, bot: 0 };

/**
 * Routing priorities. Pass-through layers rank above data; within data,
 * reads prefer cache > replica > primary and writes prefer queue > primary.
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

/** Stateless component that only forwards synchronous traffic. */
export function passThrough(priority: Priority): ComponentBehavior<null> {
  return {
    priority,
    createState: () => null,
    accepts: (req) => !req.async && priority[req.kind] > 0,
    handle: () => ({ action: 'forward' }),
  };
}
