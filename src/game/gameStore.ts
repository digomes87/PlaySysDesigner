import { create } from 'zustand';
import { addNode, connect, disconnect, moveNode, nodeFromPalette, removeNode, type Position } from '../content/boardOps';
import type { Level, PaletteItem, Question } from '../content/schema';
import { applySolution } from '../content/solution';
import { validateBoard, type BoardIssueCode } from '../engine/boardRules';
import type { Board, SimResult } from '../engine/types';
import { pickQuestion } from '../loop/pickQuestion';
import type { Answer } from '../progress/types';

export type Stage = 'predict' | 'build' | 'run' | 'diagnose' | 'justify' | 'complete' | 'solution';

export const FAILED_RUNS_BEFORE_SOLUTION = 3;

interface GameState {
  readonly level: Level | null;
  readonly board: Board;
  readonly stage: Stage;
  readonly result: SimResult | null;
  /** Question of the current step, picked on entry so it does not change after the answer. */
  readonly question: Question | null;
  readonly hintsShown: number;
  /** Last board rule violated, to warn the player. */
  readonly notice: BoardIssueCode | null;
  /** How many times the diagnosis has appeared: reshuffles the options each time. */
  readonly attempt: number;
  /** The board on screen is the reference solution: a pass does not complete the level. */
  readonly showingSolution: boolean;
  /** `answers` is the player's history: it decides which question of each pool appears. */
  begin(level: Level, answers: readonly Answer[]): void;
  goTo(stage: Stage): void;
  finishRun(result: SimResult, answers: readonly Answer[]): void;
  place(item: PaletteItem, position: Position): void;
  remove(nodeId: string): void;
  move(nodeId: string, position: Position): void;
  link(from: string, to: string): void;
  unlink(edgeId: string): void;
  resetBoard(): void;
  showNextHint(): void;
  showSolution(): void;
  leaveSolution(): void;
  dismissNotice(): void;
}

const EMPTY_BOARD: Board = { nodes: [], edges: [] };

export function isSolutionUnlocked(state: Pick<GameState, 'attempt'>): boolean {
  return state.attempt >= FAILED_RUNS_BEFORE_SOLUTION;
}

function nextNodeId(board: Board, paletteId: string): string {
  const taken = new Set(board.nodes.map((node) => node.id));
  let sequence = 1;
  while (taken.has(`${paletteId}-${sequence}`)) sequence += 1;
  return `${paletteId}-${sequence}`;
}

/** Loop state machine of a level: predict -> build -> run -> diagnose | justify. */
export const useGameStore = create<GameState>((set, get) => ({
  level: null,
  board: EMPTY_BOARD,
  stage: 'predict',
  result: null,
  question: null,
  hintsShown: 0,
  notice: null,
  attempt: 0,
  showingSolution: false,

  begin(level, answers) {
    set({
      level,
      board: level.initialBoard,
      stage: 'predict',
      result: null,
      question: pickQuestion(level.predictQuestions, answers),
      hintsShown: 0,
      notice: null,
      attempt: 0,
      showingSolution: false,
    });
  },
  goTo(stage) {
    set({ stage, notice: null });
  },
  finishRun(result, answers) {
    const { level, attempt, showingSolution } = get();
    if (!level) return;
    if (showingSolution) {
      set({ result, stage: 'solution', question: null });
      return;
    }
    if (result.passed) {
      set({ result, stage: 'justify', question: pickQuestion(level.justifyQuestions, answers) });
      return;
    }
    // The question comes from the pool of the metric that failed first.
    const metric = result.firstViolation?.metric;
    const question = metric ? pickQuestion(level.diagnoseQuestions[metric] ?? [], answers) : null;
    set({ result, question, stage: question ? 'diagnose' : 'build', attempt: attempt + 1 });
  },
  place(item, position) {
    const { board, level } = get();
    if (!level) return;
    const placed = board.nodes.filter((node) => node.paletteId === item.id).length;
    if (placed >= item.max) return;
    set({ board: addNode(board, nodeFromPalette(item, nextNodeId(board, item.id), position)), notice: null });
  },
  remove(nodeId) {
    set({ board: removeNode(get().board, nodeId), notice: null });
  },
  move(nodeId, position) {
    set({ board: moveNode(get().board, nodeId, position) });
  },
  link(from, to) {
    const { board } = get();
    const candidate = connect(board, from, to);
    if (candidate === board) {
      set({ notice: 'duplicate_edge' });
      return;
    }
    // Reject only what the new link caused: older problems do not block further building.
    const before = new Set(validateBoard(board).map((issue) => issue.code));
    const caused = validateBoard(candidate).find((issue) => !before.has(issue.code));
    if (caused) set({ notice: caused.code });
    else set({ board: candidate, notice: null });
  },
  unlink(edgeId) {
    set({ board: disconnect(get().board, edgeId), notice: null });
  },
  resetBoard() {
    const { level } = get();
    if (level) set({ board: level.initialBoard, notice: null });
  },
  showNextHint() {
    const { level, hintsShown } = get();
    if (level) set({ hintsShown: Math.min(level.hints.length, hintsShown + 1) });
  },
  showSolution() {
    const state = get();
    if (!state.level || !isSolutionUnlocked(state)) return;
    set({ board: applySolution(state.level), stage: 'run', showingSolution: true, notice: null });
  },
  leaveSolution() {
    const { level } = get();
    if (!level) return;
    set({ board: level.initialBoard, stage: 'build', showingSolution: false, result: null, notice: null });
  },
  dismissNotice() {
    set({ notice: null });
  },
}));
