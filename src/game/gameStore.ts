import { create } from 'zustand';
import { addNode, connect, disconnect, moveNode, nodeFromPalette, removeNode, type Position } from '../content/boardOps';
import type { Level, PaletteItem, Question } from '../content/schema';
import { validateBoard, type BoardIssueCode } from '../engine/boardRules';
import type { Board, SimResult } from '../engine/types';
import { pickQuestion } from '../loop/pickQuestion';
import type { Answer } from '../progress/types';

export type Stage = 'predict' | 'build' | 'run' | 'diagnose' | 'justify' | 'complete';

interface GameState {
  readonly level: Level | null;
  readonly board: Board;
  readonly stage: Stage;
  readonly result: SimResult | null;
  /** Pergunta da etapa atual, escolhida ao entrar nela para não trocar depois da resposta. */
  readonly question: Question | null;
  readonly hintsShown: number;
  /** Última regra de montagem violada, para avisar o jogador. */
  readonly notice: BoardIssueCode | null;
  /** Quantas vezes o diagnóstico já apareceu: muda a ordem das opções a cada vez. */
  readonly attempt: number;
  /** `answers` é o histórico do jogador: decide qual pergunta de cada banco aparece. */
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
  dismissNotice(): void;
}

const EMPTY_BOARD: Board = { nodes: [], edges: [] };

function nextNodeId(board: Board, paletteId: string): string {
  const taken = new Set(board.nodes.map((node) => node.id));
  let sequence = 1;
  while (taken.has(`${paletteId}-${sequence}`)) sequence += 1;
  return `${paletteId}-${sequence}`;
}

/** Máquina do loop de uma fase: prever -> montar -> rodar -> diagnosticar | justificar. */
export const useGameStore = create<GameState>((set, get) => ({
  level: null,
  board: EMPTY_BOARD,
  stage: 'predict',
  result: null,
  question: null,
  hintsShown: 0,
  notice: null,
  attempt: 0,

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
    });
  },
  goTo(stage) {
    set({ stage, notice: null });
  },
  finishRun(result, answers) {
    const { level, attempt } = get();
    if (!level) return;
    if (result.passed) {
      set({ result, stage: 'justify', question: pickQuestion(level.justifyQuestions, answers) });
      return;
    }
    // A pergunta vem do banco da métrica que violou primeiro.
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
    // Só rejeita o que a nova ligação causou: problemas antigos não impedem de continuar montando.
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
  dismissNotice() {
    set({ notice: null });
  },
}));
