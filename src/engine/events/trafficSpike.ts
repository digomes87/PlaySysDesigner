import type { EventHandler } from '../types';
import { effectEndMs, requireNumber } from './params';

/** Multiplies base traffic by `multiplier` for `durationSec`. */
export const trafficSpike: EventHandler = (event, ctx) => {
  ctx.traffic.addMultiplier(requireNumber(event, 'multiplier'), effectEndMs(event, ctx.nowMs));
};
