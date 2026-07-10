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

/**
 * Executor hook for hybrid search within a library. It owns the search data and
 * persisted preferences but does NOT decide *when* to search — the caller (the
 * orchestrator in useSearchSession) drives that via `search()`. This keeps the
 * hook free of implicit sequencing (no auto-trigger effects).
 *
 * `initialPrefs` are supplied by the route loader, so preference state is seeded
 * synchronously on the first render — no post-mount fetch and no flash of
 * defaults followed by a re-search once saved prefs arrive.
 */
export function useSearch(libraryId: string, initialPrefs?: SearchPreferences | null) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  const [hybridWeights, setHybridWeights] = useState<HybridWeights>(
    initialPrefs?.hybridWeights ?? DEFAULT_HYBRID_WEIGHTS,
  )
  const [maxResults, setMaxResults] = useState(initialPrefs?.maxResults ?? DEFAULT_MAX_RESULTS)
  const [minScore, setMinScore] = useState(initialPrefs?.minScore ?? DEFAULT_MIN_SCORE)
  const [llmMaxTokens, setLlmMaxTokens] = useState(initialPrefs?.llmMaxTokens ?? LLM_MAX_TOKENS)
  const abortRef = useRef(0)
  // Always-current snapshot of prefs used by wrapped setters to avoid stale closures
  const prefsRef = useRef({ hybridWeights, maxResults, minScore, llmMaxTokens })
  prefsRef.current = { hybridWeights, maxResults, minScore, llmMaxTokens }

  // Returns the results it produced so the orchestrator can react without waiting
  // for a re-render. Empty query / stale run / error all resolve to [].
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

      try {
        const searchResults = await searchService(
          trimmed,
          libraryId,
          maxResults,
          hybridWeights,
          minScore,
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
    [libraryId, hybridWeights, maxResults, minScore],
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
  }
}
