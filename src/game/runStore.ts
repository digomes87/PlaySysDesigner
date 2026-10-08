import { create } from 'zustand';
import { createSimulation } from '../engine/simulation';
import { TICK_MS, type SimConfig, type SimResult, type Simulation, type SloViolation, type TickSnapshot } from '../engine/types';

export const SPEEDS = [2, 4, 8] as const;
export type Speed = (typeof SPEEDS)[number];

/** Teto de ticks por quadro: aba em segundo plano não pode travar a volta ao primeiro plano. */
const MAX_TICKS_PER_FRAME = 40;

interface RunState {
  readonly status: 'idle' | 'running' | 'paused' | 'finished';
  readonly snapshot: TickSnapshot | null;
  readonly violations: readonly SloViolation[];
  readonly result: SimResult | null;
  readonly speed: Speed;
  readonly durationSec: number;
  start(config: SimConfig, onFinish: (result: SimResult) => void): void;
  pause(): void;
  resume(): void;
  skip(): void;
  setSpeed(speed: Speed): void;
  /** Para a simulação e limpa o que estava na tela. */
  clear(): void;
}

/**
 * Liga o motor headless ao relógio da tela. A simulação em si fica fora do estado
 * (é mutável); o store só guarda o retrato do último tick, que é o que a UI desenha.
 */
export const useRunStore = create<RunState>((set, get) => {
  let simulation: Simulation | null = null;
  let onFinish: ((result: SimResult) => void) | null = null;
  let frame: number | null = null;
  let lastFrameMs = 0;
  let ticksDue = 0;

  function stopLoop(): void {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  }

  function finish(): void {
    stopLoop();
    if (!simulation) return;
    const result = simulation.result();
    const notify = onFinish;
    simulation = null;
    onFinish = null;
    set({ status: 'finished', result, violations: result.violations });
    notify?.(result);
  }

  function advance(ticks: number): void {
    if (!simulation) return;
    let snapshot: TickSnapshot | null = null;
    for (let index = 0; index < ticks && !simulation.isFinished(); index += 1) snapshot = simulation.step();
    if (snapshot) set({ snapshot, violations: simulation.result().violations });
    if (simulation.isFinished()) finish();
  }

  function loop(nowMs: number): void {
    const elapsedMs = nowMs - lastFrameMs;
    lastFrameMs = nowMs;
    ticksDue += (elapsedMs / TICK_MS) * get().speed;
    const whole = Math.min(MAX_TICKS_PER_FRAME, Math.floor(ticksDue));
    ticksDue -= Math.floor(ticksDue);
    advance(whole);
    if (get().status === 'running') frame = requestAnimationFrame(loop);
  }

  function startLoop(): void {
    stopLoop();
    lastFrameMs = performance.now();
    ticksDue = 0;
    frame = requestAnimationFrame(loop);
  }

  return {
    status: 'idle',
    snapshot: null,
    violations: [],
    result: null,
    speed: 4,
    durationSec: 0,

    start(config, callback) {
      stopLoop();
      simulation = createSimulation(config);
      onFinish = callback;
      set({ status: 'running', snapshot: null, violations: [], result: null, durationSec: config.durationSec });
      startLoop();
    },
    pause() {
      if (get().status !== 'running') return;
      stopLoop();
      set({ status: 'paused' });
    },
    resume() {
      if (get().status !== 'paused') return;
      set({ status: 'running' });
      startLoop();
    },
    skip() {
      if (!simulation) return;
      stopLoop();
      advance(Number.MAX_SAFE_INTEGER);
    },
    setSpeed(speed) {
      set({ speed });
    },
    clear() {
      stopLoop();
      simulation = null;
      onFinish = null;
      set({ status: 'idle', snapshot: null, violations: [], result: null });
    },
  };
});
