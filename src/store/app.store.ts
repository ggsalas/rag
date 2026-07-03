import { create } from 'zustand'

export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface AppState {
  modelStatus: ModelStatus
  setModelStatus: (status: ModelStatus) => void
  llmStatus: ModelStatus
  llmProgress: number
  setLlmStatus: (status: ModelStatus) => void
  setLlmProgress: (progress: number) => void
}

export const useAppStore = create<AppState>((set) => ({
  modelStatus: 'idle',
  setModelStatus: (status) => set({ modelStatus: status }),
  llmStatus: 'idle',
  llmProgress: 0,
  setLlmStatus: (status) => set({ llmStatus: status }),
  setLlmProgress: (progress) => set({ llmProgress: progress }),
}))
