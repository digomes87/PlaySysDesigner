import type { ComponentBehavior, SimRequest } from '../types';
import { PRIORITY } from './shared';

/** Abaixo disto não compensa compactar o array de trabalhos já entregues. */
const COMPACT_THRESHOLD = 1024;

interface QueueState {
  jobs: SimRequest[];
  /** Índice do próximo trabalho a entregar; evita `shift` em fila grande. */
  head: number;
}

function depth(state: QueueState): number {
  return state.jobs.length - state.head;
}

function compact(state: QueueState): void {
  if (state.head < COMPACT_THRESHOLD || state.head * 2 < state.jobs.length) return;
  state.jobs = state.jobs.slice(state.head);
  state.head = 0;
}

/**
 * Fila durável. Confirma a escrita ao cliente na hora (ack) e guarda o trabalho;
 * a cada tick entrega aos workers ligados a ela o que eles conseguem pegar.
 * `bufferSize` é a profundidade máxima: fila cheia descarta.
 */
export const queue: ComponentBehavior<QueueState> = {
  priority: { read: 0, write: PRIORITY.queue, bot: 0 },
  createState: () => ({ jobs: [], head: 0 }),
  accepts: (req) => !req.async && req.kind === 'write',
  handle(req, node) {
    if (depth(node.state) >= node.node.spec.bufferSize) return { action: 'drop', reason: 'saturated' };
    node.state.jobs.push({ ...req, async: true, latencyMs: 0, hops: 0 });
    return { action: 'ack' };
  },
  onTick(node, ctx) {
    const { state } = node;
    while (depth(state) > 0) {
      const job = state.jobs[state.head];
      if (!job || !ctx.dispatch(job, node.node.id)) break;
      state.head += 1;
    }
    compact(state);
  },
  onEvent(event, node, ctx) {
    if (event.type !== 'disk_failure') return;
    ctx.addLostWrites(depth(node.state));
    node.state.jobs = [];
    node.state.head = 0;
  },
  backlog: (node) => depth(node.state),
};
