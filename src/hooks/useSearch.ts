import { useState, useCallback, useRef } from 'react'
import { search as searchService } from '@/services/search/search.service'
import * as libraryService from '@/services/library.service'
import {
  DEFAULT_MAX_RESULTS,
  DEFAULT_MIN_SCORE,
  DEFAULT_HYBRID_WEIGHTS,
  LLM_MAX_TOKENS,
} from '@/lib/constants'
import type { SearchResult, HybridWeights } from '@/types/search'
import type { SearchPreferences } from '@/types/library'

/** Optional initial state for restoring from navigation */
interface SearchInit {
  query?: string
  results?: SearchResult[]
  isAiMode?: boolean
}

/**
 * Executor hook for hybrid search within a library. It owns the search data and
 * persisted preferences but does NOT decide *when* to search — the caller (the
 * orchestrator in useSearchSession) drives that via `search()`. This keeps the
 * hook free of implicit sequencing (no auto-trigger effects).
 *
 * `initialPrefs` are supplied by the route loader, so preference state is seeded
 * synchronously on the first render — no post-mount fetch and no flash of
 * defaults followed by a re-search once saved prefs arrive.
 *
 * `init` allows restoring query/results from navigation state without re-searching.
 */
export function useSearch(
  libraryId: string,
  initialPrefs?: SearchPreferences | null,
  init?: SearchInit,
) {
  const [query, setQuery] = useState(init?.query ?? '')
  const [results, setResults] = useState<SearchResult[]>(init?.results ?? [])
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(!!init?.results?.length)
  const [hybridWeights, setHybridWeights] = useState<HybridWeights>(
    initialPrefs?.hybridWeights ?? DEFAULT_HYBRID_WEIGHTS,
  )
  const [maxResults, setMaxResults] = useState(initialPrefs?.maxResults ?? DEFAULT_MAX_RESULTS)
  const [minScore, setMinScore] = useState(initialPrefs?.minScore ?? DEFAULT_MIN_SCORE)
  const [llmMaxTokens, setLlmMaxTokens] = useState(initialPrefs?.llmMaxTokens ?? LLM_MAX_TOKENS)
  const [isAiMode, setIsAiMode] = useState(init?.isAiMode ?? initialPrefs?.isAiMode ?? false)
  const abortRef = useRef(0)
  // Always-current snapshot of prefs used by wrapped setters to avoid stale closures
  const prefsRef = useRef({ hybridWeights, maxResults, minScore, llmMaxTokens, isAiMode })
  prefsRef.current = { hybridWeights, maxResults, minScore, llmMaxTokens, isAiMode }

  // Returns the results it produced so the orchestrator can react without waiting
  // for a re-render. Empty query / stale run / error all resolve to [].
  // Reads from prefsRef to always use fresh preference values.
  const performSearch = useCallback(
    async (searchQuery: string): Promise<SearchResult[]> => {
      const trimmed = searchQuery.trim()
      setQuery(searchQuery)

      if (!trimmed) {
        setResults([])
        setError(null)
        setHasSearched(false)
        return []
      }

      const searchId = ++abortRef.current
      setIsSearching(true)
      setError(null)

      // Read fresh prefs from ref to avoid stale closure values
      const { maxResults: max, hybridWeights: weights, minScore: min } = prefsRef.current

      try {
        const searchResults = await searchService(
          trimmed,
          libraryId,
          max,
          weights,
          min,
        )
        if (searchId !== abortRef.current) return []
        setResults(searchResults)
        setHasSearched(true)
        return searchResults
      } catch (err) {
        if (searchId === abortRef.current) {
          setError(err instanceof Error ? err.message : 'Search failed')
          setResults([])
          setHasSearched(true)
        }
        return []
      } finally {
        if (searchId === abortRef.current) {
          setIsSearching(false)
        }
      }
    },
    [libraryId],
  )

  const clearResults = useCallback(() => {
    setQuery('')
    setResults([])
    setError(null)
    setHasSearched(false)
    abortRef.current++
  }, [])

  const handleSetHybridWeights = useCallback(
    (weights: HybridWeights) => {
      setHybridWeights(weights)
      libraryService.updateSearchPreferences(libraryId, {
        ...prefsRef.current,
        hybridWeights: weights,
      })
    },
    [libraryId],
  )

  const handleSetMaxResults = useCallback(
    (n: number) => {
      setMaxResults(n)
      libraryService.updateSearchPreferences(libraryId, {
        ...prefsRef.current,
        maxResults: n,
      })
    },
    [libraryId],
  )

  const handleSetMinScore = useCallback(
    (n: number) => {
      setMinScore(n)
      libraryService.updateSearchPreferences(libraryId, {
        ...prefsRef.current,
        minScore: n,
      })
    },
    [libraryId],
  )

  const handleSetLlmMaxTokens = useCallback(
    (n: number) => {
      setLlmMaxTokens(n)
      libraryService.updateSearchPreferences(libraryId, {
        ...prefsRef.current,
        llmMaxTokens: n,
      })
    },
    [libraryId],
  )

  const handleSetIsAiMode = useCallback(
    (enabled: boolean) => {
      setIsAiMode(enabled)
      libraryService.updateSearchPreferences(libraryId, {
        ...prefsRef.current,
        isAiMode: enabled,
      })
    },
    [libraryId],
  )

  return {
    query,
    results,
    isSearching,
    error,
    hasSearched,
    search: performSearch,
    clearResults,
    hybridWeights,
    setHybridWeights: handleSetHybridWeights,
    maxResults,
    setMaxResults: handleSetMaxResults,
    minScore,
    setMinScore: handleSetMinScore,
    llmMaxTokens,
    setLlmMaxTokens: handleSetLlmMaxTokens,
    isAiMode,
    setIsAiMode: handleSetIsAiMode,
  }
}
