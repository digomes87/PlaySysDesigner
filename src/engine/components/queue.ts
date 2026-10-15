import type { ComponentBehavior, SimRequest } from '../types';
import { PRIORITY } from './shared';

/** Below this, compacting the array of delivered jobs is not worth it. */
const COMPACT_THRESHOLD = 1024;

interface QueueState {
  jobs: SimRequest[];
  /** Index of the next job to deliver; avoids `shift` on a large queue. */
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
 * Durable queue. Acknowledges the write to the client at once and keeps the job;
 * each tick it hands its linked workers as much as they can take.
 * `bufferSize` is the maximum depth: a full queue drops.
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
