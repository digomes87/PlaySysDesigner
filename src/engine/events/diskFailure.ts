import type { EventHandler } from '../types';
import { effectEndMs } from './params';

/**
 * Falha de disco: além de sair do ar por `durationSec`, o nó perde o que guardava.
 * O que exatamente se perde é decidido pelo comportamento do componente.
 */
export const diskFailure: EventHandler = (event, ctx) => {
  const untilMs = effectEndMs(event, ctx.nowMs);
  for (const target of ctx.targets(event.params)) {
    ctx.notify(event, target.node.id);
    ctx.failNode(target.node.id, untilMs);
  }
};
