import type { EventHandler } from '../types';
import { effectEndMs, requireNumber } from './params';

/** Adds `rps` of bot traffic to the level's traffic for `durationSec`. */
export const botWave: EventHandler = (event, ctx) => {
  ctx.traffic.addBotWave(requireNumber(event, 'rps'), effectEndMs(event, ctx.nowMs));
};
