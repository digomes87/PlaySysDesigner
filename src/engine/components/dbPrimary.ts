import type { ComponentBehavior } from '../types';
import { PRIORITY, samePriority } from './shared';

/** How long the primary remembers recent writes (upper bound of `lossWindowMs`). */
const COMMIT_HISTORY_MS = 60_000;

interface CommitBatch {
  readonly atMs: number;
  count: number;
}

interface DbPrimaryState {
  commits: CommitBatch[];
}

function rememberCommit(state: DbPrimaryState, nowMs: number): void {
  const latest = state.commits.at(-1);
  if (latest && latest.atMs === nowMs) {
    latest.count += 1;
    return;
  }
  state.commits = [...state.commits.filter((batch) => batch.atMs >= nowMs - COMMIT_HISTORY_MS), { atMs: nowMs, count: 1 }];
}

/** Source of truth: stores writes and always answers reads with fresh data. */
export const dbPrimary: ComponentBehavior<DbPrimaryState> = {
  priority: samePriority(PRIORITY.primary),
  createState: () => ({ commits: [] }),
  accepts: () => true,
  handle(req, node, ctx) {
    if (req.kind === 'write') {
      ctx.commitWrite(req);
      rememberCommit(node.state, ctx.nowMs);
    }
    return { action: 'respond' };
  },
  onEvent(event, node, ctx) {
    if (event.type !== 'disk_failure') return;
    const lossWindowMs = event.params.lossWindowMs;
    if (typeof lossWindowMs !== 'number' || lossWindowMs <= 0) return;
    const isUnsynced = (batch: CommitBatch): boolean => batch.atMs >= ctx.nowMs - lossWindowMs;
    const unsynced = node.state.commits.filter(isUnsynced).reduce((sum, batch) => sum + batch.count, 0);
    ctx.addLostWrites(unsynced);
    // What was already counted as lost must not be counted again on a later failure.
    node.state.commits = node.state.commits.filter((batch) => !isUnsynced(batch));
  },
};
