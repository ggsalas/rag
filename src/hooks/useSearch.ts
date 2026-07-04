import { useState, useCallback, useRef, useEffect } from 'react'
import { search as searchService } from '@/services/search/search.service'
import * as libraryService from '@/services/library.service'
import { DEFAULT_MAX_RESULTS, DEFAULT_MIN_SCORE, DEFAULT_HYBRID_WEIGHTS, LLM_MAX_TOKENS } from '@/lib/constants'
import type { SearchResult, HybridWeights } from '@/types/search'

/** Hook for performing hybrid search within a library */
export function useSearch(libraryId: string, initialQuery = '') {
  const [query, setQuery] = useState(initialQuery)
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  const [hybridWeights, setHybridWeights] = useState<HybridWeights>(DEFAULT_HYBRID_WEIGHTS)
  const [maxResults, setMaxResults] = useState(DEFAULT_MAX_RESULTS)
  const [minScore, setMinScore] = useState(DEFAULT_MIN_SCORE)
  const [llmMaxTokens, setLlmMaxTokens] = useState(LLM_MAX_TOKENS)
  const abortRef = useRef(0)
  const initialSearchDone = useRef(false)
  // Always-current snapshot of prefs used by wrapped setters to avoid stale closures
  const prefsRef = useRef({ hybridWeights, maxResults, minScore, llmMaxTokens })
  prefsRef.current = { hybridWeights, maxResults, minScore, llmMaxTokens }
  // Blocks the initial search until saved preferences are loaded from the DB,
  // preventing a first search with defaults followed by a re-search with saved prefs.
  const [prefsReady, setPrefsReady] = useState(false)

  // Load persisted preferences from the library on mount
  useEffect(() => {
    libraryService.getLibraryById(libraryId).then((library) => {
      if (library?.searchPreferences) {
        const { hybridWeights: hw, maxResults: mr, minScore: ms, llmMaxTokens: lmt } = library.searchPreferences
        setHybridWeights(hw)
        setMaxResults(mr)
        setMinScore(ms)
        if (lmt !== undefined) setLlmMaxTokens(lmt)
      }
      setPrefsReady(true)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const performSearch = useCallback(
    async (searchQuery: string) => {
      const trimmed = searchQuery.trim()
      setQuery(searchQuery)

      if (!trimmed) {
        setResults([])
        setError(null)
        setHasSearched(false)
        return
      }

      const searchId = ++abortRef.current
      setIsSearching(true)
      setError(null)

      try {
        const searchResults = await searchService(trimmed, libraryId, maxResults, hybridWeights, minScore)
        if (searchId === abortRef.current) {
          setResults(searchResults)
          setHasSearched(true)
        }
      } catch (err) {
        if (searchId === abortRef.current) {
          setError(err instanceof Error ? err.message : 'Search failed')
          setResults([])
          setHasSearched(true)
        }
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

  useEffect(() => {
    if (!prefsReady) return
    if (initialQuery.trim() && !initialSearchDone.current) {
      initialSearchDone.current = true
      performSearch(initialQuery)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery, prefsReady])

  // Re-run search when search config changes
  useEffect(() => {
    if (query.trim() && hasSearched) {
      performSearch(query)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hybridWeights, maxResults, minScore])

  const handleSetHybridWeights = useCallback((weights: HybridWeights) => {
    setHybridWeights(weights)
    libraryService.updateSearchPreferences(libraryId, { ...prefsRef.current, hybridWeights: weights })
  }, [libraryId])

  const handleSetMaxResults = useCallback((n: number) => {
    setMaxResults(n)
    libraryService.updateSearchPreferences(libraryId, { ...prefsRef.current, maxResults: n })
  }, [libraryId])

  const handleSetMinScore = useCallback((n: number) => {
    setMinScore(n)
    libraryService.updateSearchPreferences(libraryId, { ...prefsRef.current, minScore: n })
  }, [libraryId])

  const handleSetLlmMaxTokens = useCallback((n: number) => {
    setLlmMaxTokens(n)
    libraryService.updateSearchPreferences(libraryId, { ...prefsRef.current, llmMaxTokens: n })
  }, [libraryId])

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
