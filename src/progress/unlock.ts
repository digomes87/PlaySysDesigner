import type { Clock, LevelProgress } from './types';

const HOUR_MS = 60 * 60 * 1000;

export interface UnlockRule {
  readonly afterLevel: string;
  readonly delayHours: number;
}

export interface LevelGate {
  readonly id: string;
  readonly unlock?: UnlockRule;
}

export type LevelAccess =
  | { readonly status: 'open' }
  /** Another level must be completed first. */
  | { readonly status: 'locked'; readonly requires: string }
  /** The previous level is complete, but the waiting period has not passed yet. */
  | { readonly status: 'waiting'; readonly availableAt: string };

function completedAt(levelId: string, progress: readonly LevelProgress[]): string | null {
  return progress.find((entry) => entry.levelId === levelId)?.completedAt ?? null;
}

/**
 * Levels open in order: each requires the previous one completed. A level with an
 * `unlock` rule also requires `delayHours` to pass since `afterLevel` was completed,
 * which is what turns the review level into a retention test.
 */
export function levelAccess(
  levels: readonly LevelGate[],
  levelId: string,
  progress: readonly LevelProgress[],
  clock: Clock,
): LevelAccess {
  const position = levels.findIndex((level) => level.id === levelId);
  const level = levels[position];
  if (!level) return { status: 'locked', requires: levelId };

  const previous = levels[position - 1];
  if (previous && completedAt(previous.id, progress) === null) return { status: 'locked', requires: previous.id };
  if (!level.unlock) return { status: 'open' };

  const gateDoneAt = completedAt(level.unlock.afterLevel, progress);
  if (gateDoneAt === null) return { status: 'locked', requires: level.unlock.afterLevel };
  const availableMs = Date.parse(gateDoneAt) + level.unlock.delayHours * HOUR_MS;
  if (clock.now().getTime() >= availableMs) return { status: 'open' };
  return { status: 'waiting', availableAt: new Date(availableMs).toISOString() };
}
