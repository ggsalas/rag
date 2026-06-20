import { create } from 'zustand'

export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface AppState {
  modelStatus: ModelStatus
  stats: {
    totalLibraries: number
    totalDocuments: number
    totalChunks: number
  }
  // Actions
  setModelStatus: (status: ModelStatus) => void
  setStats: (stats: Partial<AppState['stats']>) => void
}

export const useAppStore = create<AppState>((set) => ({
  modelStatus: 'idle',
  stats: {
    totalLibraries: 0,
    totalDocuments: 0,
    totalChunks: 0,
  },

  setModelStatus: (status) => set({ modelStatus: status }),

  setStats: (stats) =>
    set((state) => ({
      stats: { ...state.stats, ...stats },
    })),
}))
