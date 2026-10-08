import type { Board, EventParams, ScheduledEvent, SimConfig } from '../engine/types';
import type { Level, LevelEvent } from './schema';

/** Tira os parâmetros opcionais ausentes: o motor espera só número ou texto. */
function toEventParams(params: LevelEvent['params']): EventParams {
  const entries = Object.entries(params).filter(
    (entry): entry is [string, number | string] => typeof entry[1] === 'number' || typeof entry[1] === 'string',
  );
  return Object.fromEntries(entries);
}

function toScheduledEvent(event: LevelEvent): ScheduledEvent {
  return { atSec: event.atSec, type: event.type, params: toEventParams(event.params), conceptId: event.conceptId };
}

/** Junta a fase com o tabuleiro montado pelo jogador na configuração que o motor roda. */
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
