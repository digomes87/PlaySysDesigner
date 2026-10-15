import type { Board, EventParams, ScheduledEvent, SimConfig } from '../engine/types';
import type { Level, LevelEvent } from './schema';

/** Drops absent optional params: the engine expects only numbers or text. */
function toEventParams(params: LevelEvent['params']): EventParams {
  const entries = Object.entries(params).filter(
    (entry): entry is [string, number | string] => typeof entry[1] === 'number' || typeof entry[1] === 'string',
  );
  return Object.fromEntries(entries);
}

function toScheduledEvent(event: LevelEvent): ScheduledEvent {
  return { atSec: event.atSec, type: event.type, params: toEventParams(event.params), conceptId: event.conceptId };
}

/** Combines the level with the player's board into the config the engine runs. */
export function buildSimConfig(level: Level, board: Board): SimConfig {
  return {
    board,
    traffic: level.traffic,
    events: level.events.map(toScheduledEvent),
    slos: level.slos,
    durationSec: level.durationSec,
    seed: level.seed,
    costBudget: level.costBudget,
  };
}
