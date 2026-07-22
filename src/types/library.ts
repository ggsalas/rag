import type { HybridWeights } from './search'

export type SearchPreferences = {
  hybridWeights: HybridWeights
  maxResults: number
  minScore: number
  llmMaxTokens?: number
  isAiMode?: boolean
}

export type Library = {
  id: string
  name: string
  description?: string
  createdAt: number
  updatedAt: number
  documentCount: number
  chunkCount: number
  searchPreferences?: SearchPreferences
}
