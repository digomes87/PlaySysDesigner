import { create } from 'zustand';
import { progressRepository } from './index';
import { parseProgressFile, serializeProgress } from './progressFile';
import { systemClock, type Answer, type LevelProgress, type ProgressExport } from './types';

interface ProgressState {
  readonly status: 'idle' | 'ready';
  readonly answers: readonly Answer[];
  readonly levels: readonly LevelProgress[];
  /** O armazenamento do aparelho falhou: o progresso vale só até fechar a aba. */
  readonly storageFailed: boolean;
  load(): Promise<void>;
  recordAnswer(answer: Omit<Answer, 'at'>): Promise<void>;
  recordRun(levelId: string): Promise<void>;
  completeLevel(levelId: string): Promise<void>;
  exportFile(): Promise<{ readonly text: string; readonly data: ProgressExport }>;
  importFile(text: string): Promise<void>;
  reset(): Promise<void>;
}

function upsert(levels: readonly LevelProgress[], next: LevelProgress): LevelProgress[] {
  return [...levels.filter((level) => level.levelId !== next.levelId), next];
}

function find(levels: readonly LevelProgress[], levelId: string): LevelProgress {
  return levels.find((level) => level.levelId === levelId) ?? { levelId, runs: 0, completedAt: null };
}

/**
 * Espelho em memória do repositório de progresso. A tela lê daqui; cada escrita vai
 * primeiro para a memória e depois para o aparelho, e uma falha de armazenamento
 * (ex.: navegação privada) não interrompe o jogo.
 */
export const useProgressStore = create<ProgressState>((set, get) => {
  async function persist(write: () => Promise<void>): Promise<void> {
    try {
      await write();
    } catch {
      set({ storageFailed: true });
    }
  }

  return {
    status: 'idle',
    answers: [],
    levels: [],
    storageFailed: false,

    async load() {
      try {
        const [answers, levels] = await Promise.all([
          progressRepository.listAnswers(),
          progressRepository.listLevelProgress(),
        ]);
        set({ status: 'ready', answers, levels });
      } catch {
        set({ status: 'ready', storageFailed: true });
      }
    },

    async recordAnswer(partial) {
      const answer: Answer = { ...partial, at: systemClock.now().toISOString() };
      set({ answers: [...get().answers, answer] });
      await persist(() => progressRepository.recordAnswer(answer));
    },

    async recordRun(levelId) {
      const current = find(get().levels, levelId);
      const next = { ...current, runs: current.runs + 1 };
      set({ levels: upsert(get().levels, next) });
      await persist(() => progressRepository.saveLevelProgress(next));
    },

    async completeLevel(levelId) {
      const current = find(get().levels, levelId);
      if (current.completedAt !== null) return;
      const next = { ...current, completedAt: systemClock.now().toISOString() };
      set({ levels: upsert(get().levels, next) });
      await persist(() => progressRepository.saveLevelProgress(next));
    },

    async exportFile() {
      const data = await progressRepository.exportAll();
      return { text: serializeProgress(data), data };
    },

    async importFile(text) {
      const data = parseProgressFile(text);
      await progressRepository.importAll(data);
      set({ answers: data.answers, levels: data.levels });
    },

    async reset() {
      await progressRepository.clear();
      set({ answers: [], levels: [] });
    },
  };
});
