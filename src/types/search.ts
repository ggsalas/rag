export type SearchQuery = {
  text: string
  topK: number
}

export type HybridWeights = {
  text: number
  vector: number
}

export type SearchResult = {
  chunkId: string
  documentId: string
  documentName: string
  text: string
  score: number
  chunkIndex: number
}

import type { LLMCitation } from '@/services/llm/llm.service'

/** Complete search state persisted to router state so it survives navigation */
export type SavedSearchState = {
  query: string
  results: SearchResult[]
  focusedChunkId?: string | null
  ai?: {
    answer: string
    citations: LLMCitation[]
  }
}

/** Options passed to submitQuery for the current pipeline run */
export type PipelineOptions = {
  libraryId: string
  isAiMode: boolean
  hybridWeights: HybridWeights
  maxResults: number
  minScore: number
  llmMaxTokens: number
}

/** Callback invoked when a pipeline run completes successfully (not aborted) */
export type OnSettledCallback = (state: SavedSearchState) => void
