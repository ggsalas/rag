import type { HybridWeights, SearchPreset } from './search'

export type SearchPreferences = {
  /** Current search preset (preferred) */
  searchPreset?: SearchPreset
  /** Legacy hybrid weights — kept in sync with searchPreset for backward compatibility */
  hybridWeights?: HybridWeights
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
