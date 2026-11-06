import { create } from 'zustand';
import type { CorpusProject } from '../services/corpus/types';
import { serializeProject } from '../services/corpus/persistence';

interface CorpusState {
  project: CorpusProject | null;
  past: CorpusProject[];
  future: CorpusProject[];
  selected: string[];
  saving: 'idle' | 'saving' | 'saved' | 'error';
  setProject(project: CorpusProject): void;
  apply(change: (project: CorpusProject) => CorpusProject): void;
  undo(): void;
  redo(): void;
  select(id: string, multi?: boolean): void;
  selectMany(ids: string[]): void;
  setSaving(state: CorpusState['saving']): void;
}
export const useCorpusStore = create<CorpusState>((set, get) => ({
  project: null, past: [], future: [], selected: [], saving: 'idle',
  setProject: project => {
    serializeProject(project);
    set({ project, past: [], future: [], selected: [], saving: 'idle' });
  },
  apply: change => {
    const state = get();
    if (!state.project) throw new Error('请先导入语料或完成文档对齐。');
    const project = change(state.project);
    serializeProject(project);
    if (project !== state.project) set({ project, past: [...state.past.slice(-19), state.project], future: [],
      selected: state.selected.filter(id => project.units.some(unit => unit.id === id)), saving: 'idle' });
  },
  undo: () => {
    const state = get(), project = state.past.at(-1);
    if (project && state.project) set({ project, past: state.past.slice(0, -1), future: [state.project, ...state.future], selected: [], saving: 'idle' });
  },
  redo: () => {
    const state = get(), project = state.future[0];
    if (project && state.project) set({ project, past: [...state.past.slice(-19), state.project], future: state.future.slice(1), selected: [], saving: 'idle' });
  },
  select: (id, multi = true) => set(state => ({ selected: multi
    ? state.selected.includes(id) ? state.selected.filter(value => value !== id) : [...state.selected, id]
    : [id] })),
  selectMany: selected => set({ selected }),
  setSaving: saving => set({ saving }),
}));
