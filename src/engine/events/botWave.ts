import type { EventHandler } from '../types';
import { effectEndMs, requireNumber } from './params';

/** Soma `rps` de tráfego de bot ao tráfego da fase durante `durationSec`. */
export const botWave: EventHandler = (event, ctx) => {
  ctx.traffic.addBotWave(requireNumber(event, 'rps'), effectEndMs(event, ctx.nowMs));
};
