import type { EventHandler } from '../types';
import { effectEndMs, requireString } from './params';

/** Corta as ligações entre `fromId` e `toId` durante `durationSec`; os nós seguem no ar. */
export const networkPartition: EventHandler = (event, ctx) => {
  ctx.cutEdges(requireString(event, 'fromId'), requireString(event, 'toId'), effectEndMs(event, ctx.nowMs));
};
