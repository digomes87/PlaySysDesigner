import type { EventHandler } from '../types';
import { effectEndMs, requireNumber } from './params';

/** Multiplica o tráfego base por `multiplier` durante `durationSec`. */
export const trafficSpike: EventHandler = (event, ctx) => {
  ctx.traffic.addMultiplier(requireNumber(event, 'multiplier'), effectEndMs(event, ctx.nowMs));
};
