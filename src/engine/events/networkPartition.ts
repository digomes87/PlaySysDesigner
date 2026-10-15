import type { EventHandler } from '../types';
import { effectEndMs, requireString } from './params';

/** Cuts the links between `fromId` and `toId` for `durationSec`; the nodes stay up. */
export const networkPartition: EventHandler = (event, ctx) => {
  ctx.cutEdges(requireString(event, 'fromId'), requireString(event, 'toId'), effectEndMs(event, ctx.nowMs));
};
