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
  rerankerStatus: ModelStatus
  rerankerProgress: number
  setRerankerStatus: (status: ModelStatus) => void
  setRerankerProgress: (progress: number) => void
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
  rerankerStatus: 'idle',
  rerankerProgress: 0,
  setRerankerStatus: (status) => set({ rerankerStatus: status }),
  setRerankerProgress: (progress) => set({ rerankerProgress: progress }),
}))
