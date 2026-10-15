import type { EventHandler } from '../types';
import { optionalNumber, requireNumber } from './params';

/** Moves base traffic linearly to `toRps` over `durationSec`. */
export const trafficRamp: EventHandler = (event, ctx) => {
  const durationMs = optionalNumber(event, 'durationSec', 0) * 1000;
  ctx.traffic.startRamp(requireNumber(event, 'toRps'), ctx.nowMs, durationMs);
};
