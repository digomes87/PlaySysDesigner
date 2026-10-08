import { create } from 'zustand';
import { loadContentIndex, loadLevel } from './loader';
import type { ContentIndex, Level } from './schema';

interface ContentState {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly index: ContentIndex | null;
  /** Na ordem do índice. */
  readonly levels: readonly Level[];
  readonly error: string | null;
  load(): Promise<void>;
}

/** O conteúdo é pequeno (quatro fases): baixa tudo de uma vez, em paralelo. */
export const useContentStore = create<ContentState>((set, get) => ({
  status: 'idle',
  index: null,
  levels: [],
  error: null,
  async load() {
    if (get().status === 'loading') return;
    set({ status: 'loading', error: null });
    try {
      const index = await loadContentIndex();
      const levels = await Promise.all(index.levels.map(loadLevel));
      set({ status: 'ready', index, levels });
    } catch (error) {
      set({ status: 'error', error: error instanceof Error ? error.message : String(error) });
    }
  },
}));
