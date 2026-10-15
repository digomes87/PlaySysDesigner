import { PRIORITY, passThrough, samePriority } from './shared';

/** Processes the request and forwards it to the data layer linked to it. */
export const appServer = passThrough(samePriority(PRIORITY.appServer));
