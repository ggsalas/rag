import { useState, useCallback, useRef, useMemo } from 'react'
import * as libraryService from '@/services/library.service'
import {
  DEFAULT_MAX_RESULTS,
  DEFAULT_MIN_SCORE,
  DEFAULT_SEARCH_PRESET,
  SEARCH_PRESETS,
  LLM_MAX_TOKENS,
} from '@/lib/constants'
import type { SearchPreset, HybridWeights } from '@/types/search'
import type { SearchPreferences } from '@/types/library'

export interface SearchPreferencesAPI {
  searchPreset: SearchPreset
  setSearchPreset: (preset: SearchPreset) => void
  /** Derived from searchPreset — read-only for pipeline compatibility */
  hybridWeights: HybridWeights
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
 * Infers the closest SearchPreset from legacy hybrid weights.
 * - 50/50 → balanced
 * - vector-dominant (vector >= 0.7) → semantic
 * - otherwise → balanced (default)
 */
export function inferPresetFromWeights(weights: HybridWeights): SearchPreset {
  if (weights.text === 0.5 && weights.vector === 0.5) return 'balanced'
  if (weights.vector >= 0.7) return 'semantic'
  return 'balanced'
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
  // Infer initial preset: use explicit searchPreset if present, else infer from legacy weights
  const initialPreset = useMemo(() => {
    if (initialPrefs?.searchPreset) return initialPrefs.searchPreset
    if (initialPrefs?.hybridWeights) return inferPresetFromWeights(initialPrefs.hybridWeights)
    return DEFAULT_SEARCH_PRESET
  }, [initialPrefs?.searchPreset, initialPrefs?.hybridWeights])

  const [searchPreset, setSearchPresetState] = useState<SearchPreset>(initialPreset)
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

  // Derive hybrid weights from preset (read-only)
  const hybridWeights = SEARCH_PRESETS[searchPreset]

  // Always-current snapshot of all prefs for building the full object on persist
  const prefsRef = useRef({
    searchPreset,
    hybridWeights,
    maxResults,
    minScore,
    llmMaxTokens,
    isAiMode,
  })
  prefsRef.current = {
    searchPreset,
    hybridWeights,
    maxResults,
    minScore,
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

  const setSearchPreset = useCallback(
    (preset: SearchPreset) => {
      setSearchPresetState(preset)
      // Persist both preset and derived weights for backward compatibility
      persist({ searchPreset: preset, hybridWeights: SEARCH_PRESETS[preset] })
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
    searchPreset,
    setSearchPreset,
    hybridWeights,
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
