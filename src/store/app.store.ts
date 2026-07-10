import { create } from 'zustand'

export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface AppState {
  modelStatus: ModelStatus
  modelProgress: number
  setModelStatus: (status: ModelStatus) => void
  setModelProgress: (progress: number) => void
  llmStatus: ModelStatus
  llmProgress: number
  setLlmStatus: (status: ModelStatus) => void
  setLlmProgress: (progress: number) => void
}

export const useAppStore = create<AppState>((set) => ({
  modelStatus: 'idle',
  modelProgress: 0,
  setModelStatus: (status) => set({ modelStatus: status }),
  setModelProgress: (progress) => set({ modelProgress: progress }),
  llmStatus: 'idle',
  llmProgress: 0,
  setLlmStatus: (status) => set({ llmStatus: status }),
  setLlmProgress: (progress) => set({ llmProgress: progress }),
}))
