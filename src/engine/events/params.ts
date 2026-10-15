import type { ScheduledEvent } from '../types';

function missing(event: ScheduledEvent, name: string, expected: string): Error {
  return new Error(`Event ${event.type} (t=${event.atSec}s): param "${name}" must be ${expected}.`);
}

export function requireNumber(event: ScheduledEvent, name: string): number {
  const value = event.params[name];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw missing(event, name, 'a number');
  return value;
}

export function optionalNumber(event: ScheduledEvent, name: string, fallback: number): number {
  return event.params[name] === undefined ? fallback : requireNumber(event, name);
}

export function requireString(event: ScheduledEvent, name: string): string {
  const value = event.params[name];
  if (typeof value !== 'string' || value.length === 0) throw missing(event, name, 'um texto');
  return value;
}

/** End of the effect. Without `durationSec` the effect lasts until the end of the run. */
export function effectEndMs(event: ScheduledEvent, nowMs: number): number {
  return nowMs + optionalNumber(event, 'durationSec', Number.POSITIVE_INFINITY) * 1000;
}
