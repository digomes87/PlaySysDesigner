import { PRIORITY, passThrough, samePriority } from './shared';

/** Reparte o tráfego entre as saídas iguais; o revezamento é do roteador. */
export const loadBalancer = passThrough(samePriority(PRIORITY.loadBalancer));
