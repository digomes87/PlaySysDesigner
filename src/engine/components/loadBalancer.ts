import { PRIORITY, passThrough, samePriority } from './shared';

/** Spreads traffic across equal outputs; the router handles the rotation. */
export const loadBalancer = passThrough(samePriority(PRIORITY.loadBalancer));
