import { useState, useCallback, useRef } from 'react'
import * as libraryService from '@/services/library.service'
import {
  DEFAULT_MAX_RESULTS,
  DEFAULT_MIN_SCORE,
  DEFAULT_HYBRID_WEIGHTS,
  LLM_MAX_TOKENS,
} from '@/lib/constants'
import type { HybridWeights } from '@/types/search'
import type { SearchPreferences } from '@/types/library'

export interface SearchPreferencesAPI {
  hybridWeights: HybridWeights
  setHybridWeights: (weights: HybridWeights) => void
  maxResults: number
  setMaxResults: (n: number) => void
  minScore: number
  setMinScore: (n: number) => void
  llmMaxTokens: number
  setLlmMaxTokens: (n: number) => void
  isAiMode: boolean
  setIsAiMode: (enabled: boolean) => void
}

/**
 * Manages search preferences for a library.
 * Seeded from the route loader (no post-mount fetch).
 * Each setter updates local state immediately and persists to IndexedDB fire-and-forget.
 */
export function useSearchPreferences(
  libraryId: string,
  initialPrefs?: SearchPreferences | null,
): SearchPreferencesAPI {
  const [hybridWeights, setHybridWeightsState] = useState<HybridWeights>(
    initialPrefs?.hybridWeights ?? DEFAULT_HYBRID_WEIGHTS,
  )
  const [maxResults, setMaxResultsState] = useState(
    initialPrefs?.maxResults ?? DEFAULT_MAX_RESULTS,
  )
  const [minScore, setMinScoreState] = useState(
    initialPrefs?.minScore ?? DEFAULT_MIN_SCORE,
  )
  const [llmMaxTokens, setLlmMaxTokensState] = useState(
    initialPrefs?.llmMaxTokens ?? LLM_MAX_TOKENS,
  )
  const [isAiMode, setIsAiModeState] = useState(
    initialPrefs?.isAiMode ?? false,
  )

  // Always-current snapshot of all prefs for building the full object on persist
  const prefsRef = useRef({ hybridWeights, maxResults, minScore, llmMaxTokens, isAiMode })
  prefsRef.current = { hybridWeights, maxResults, minScore, llmMaxTokens, isAiMode }

  const persist = useCallback(
    (partial: Partial<SearchPreferences>) => {
      libraryService.updateSearchPreferences(libraryId, {
        ...prefsRef.current,
        ...partial,
      })
    },
    [libraryId],
  )

  const setHybridWeights = useCallback(
    (weights: HybridWeights) => {
      setHybridWeightsState(weights)
      persist({ hybridWeights: weights })
    },
    [persist],
  )

  const setMaxResults = useCallback(
    (n: number) => {
      setMaxResultsState(n)
      persist({ maxResults: n })
    },
    [persist],
  )

  const setMinScore = useCallback(
    (n: number) => {
      setMinScoreState(n)
      persist({ minScore: n })
    },
    [persist],
  )

  const setLlmMaxTokens = useCallback(
    (n: number) => {
      setLlmMaxTokensState(n)
      persist({ llmMaxTokens: n })
    },
    [persist],
  )

  const setIsAiMode = useCallback(
    (enabled: boolean) => {
      setIsAiModeState(enabled)
      persist({ isAiMode: enabled })
    },
    [persist],
  )

  return {
    hybridWeights,
    setHybridWeights,
    maxResults,
    setMaxResults,
    minScore,
    setMinScore,
    llmMaxTokens,
    setLlmMaxTokens,
    isAiMode,
    setIsAiMode,
  }
}
