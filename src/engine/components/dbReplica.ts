import type { ComponentBehavior } from '../types';
import { PRIORITY } from './shared';

/**
 * Cópia só de leitura. Uma escrita leva `replicationLagMs` para chegar aqui:
 * ler a chave dentro dessa janela devolve o valor antigo (staleRead).
 */
export const dbReplica: ComponentBehavior<null> = {
  priority: { read: PRIORITY.replica, write: 0, bot: PRIORITY.replica },
  createState: () => null,
  accepts: (req) => !req.async && req.kind !== 'write',
  handle(req, node, ctx) {
    if (req.kind !== 'read') return { action: 'respond' };
    const lagMs = node.node.spec.params.replicationLagMs ?? 0;
    const lastWriteAtMs = ctx.lastWriteAtMs(req.key);
    const stale = lastWriteAtMs !== undefined && ctx.nowMs - lastWriteAtMs < lagMs;
    return { action: 'respond', stale };
  },
};
