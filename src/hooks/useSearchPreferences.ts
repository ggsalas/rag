import { useState, useCallback, useRef } from 'react'
import * as libraryService from '@/services/library.service'
import {
  DEFAULT_MAX_RESULTS,
  DEFAULT_HYBRID_WEIGHTS,
  LLM_MAX_TOKENS,
} from '@/lib/constants'
import type { HybridWeights } from '@/types/search'
import type { SearchPreferences } from '@/types/library'

export interface SearchPreferencesAPI {
  /** Fixed hybrid weights — always DEFAULT_HYBRID_WEIGHTS (no user toggle). */
  hybridWeights: HybridWeights
  maxResults: number
  setMaxResults: (n: number) => void
  llmMaxTokens: number
  setLlmMaxTokens: (n: number) => void
  isAiMode: boolean
  setIsAiMode: (enabled: boolean) => void
}

/**
 * Manages search preferences for a library.
 * Seeded from the route loader (no post-mount fetch).
 * Each setter updates local state immediately and persists to IndexedDB fire-and-forget.
 *
 * Migration: legacy `searchPreset`, `hybridWeights`, and `minScore` fields in
 * persisted SearchPreferences are silently ignored. The hybrid weights are now
 * a fixed application constant (DEFAULT_HYBRID_WEIGHTS) and are NEVER persisted —
 * storing them would reintroduce the exact problem we eliminated: a persisted
 * value that survives future constant changes and anchors the user to a stale
 * setting. On the next persist of any preference, the stale fields are
 * naturally dropped from IndexedDB.
 */
export function useSearchPreferences(
  libraryId: string,
  initialPrefs?: SearchPreferences | null,
): SearchPreferencesAPI {
  const [maxResults, setMaxResultsState] = useState(
    initialPrefs?.maxResults ?? DEFAULT_MAX_RESULTS,
  )
  const [llmMaxTokens, setLlmMaxTokensState] = useState(
    initialPrefs?.llmMaxTokens ?? LLM_MAX_TOKENS,
  )
  const [isAiMode, setIsAiModeState] = useState(
    initialPrefs?.isAiMode ?? false,
  )

  // Fixed hybrid weights — no longer user-configurable, never persisted
  const hybridWeights = DEFAULT_HYBRID_WEIGHTS

  // Always-current snapshot of persisted prefs (hybridWeights excluded)
  const prefsRef = useRef({
    maxResults,
    llmMaxTokens,
    isAiMode,
  })
  prefsRef.current = {
    maxResults,
    llmMaxTokens,
    isAiMode,
  }

  const persist = useCallback(
    (partial: Partial<SearchPreferences>) => {
      libraryService.updateSearchPreferences(libraryId, {
        ...prefsRef.current,
        ...partial,
      })
    },
    [libraryId],
  )

  const setMaxResults = useCallback(
    (n: number) => {
      setMaxResultsState(n)
      persist({ maxResults: n })
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
    maxResults,
    setMaxResults,
    llmMaxTokens,
    setLlmMaxTokens,
    isAiMode,
    setIsAiMode,
  }
}
