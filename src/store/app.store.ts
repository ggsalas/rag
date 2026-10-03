import { create } from 'zustand'

export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface AppState {
  embeddingStatus: ModelStatus
  embeddingProgress: number
  setEmbeddingStatus: (status: ModelStatus) => void
  setEmbeddingProgress: (progress: number) => void
  llmStatus: ModelStatus
  llmProgress: number
  setLlmStatus: (status: ModelStatus) => void
  setLlmProgress: (progress: number) => void
  crossEncoderStatus: ModelStatus
  crossEncoderProgress: number
  setCrossEncoderStatus: (status: ModelStatus) => void
  setCrossEncoderProgress: (progress: number) => void
}

export const useAppStore = create<AppState>((set) => ({
  embeddingStatus: 'idle',
  embeddingProgress: 0,
  setEmbeddingStatus: (status) => set({ embeddingStatus: status }),
  setEmbeddingProgress: (progress) => set({ embeddingProgress: progress }),
  llmStatus: 'idle',
  llmProgress: 0,
  setLlmStatus: (status) => set({ llmStatus: status }),
  setLlmProgress: (progress) => set({ llmProgress: progress }),
  crossEncoderStatus: 'idle',
  crossEncoderProgress: 0,
  setCrossEncoderStatus: (status) => set({ crossEncoderStatus: status }),
  setCrossEncoderProgress: (progress) => set({ crossEncoderProgress: progress }),
}))
