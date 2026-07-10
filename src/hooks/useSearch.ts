import { useState, useCallback, useRef, useEffect } from 'react'
import { search as searchService } from '@/services/search/search.service'
import * as libraryService from '@/services/library.service'
import { DEFAULT_MAX_RESULTS, DEFAULT_MIN_SCORE, DEFAULT_HYBRID_WEIGHTS, LLM_MAX_TOKENS } from '@/lib/constants'
import type { SearchResult, HybridWeights } from '@/types/search'

interface UseSearchInitial {
  query: string
  results: SearchResult[]
}

/**
 * Hook for performing hybrid search within a library.
 *
 * When `initial` is provided (results already computed elsewhere, e.g. restored
 * from route state), it hydrates the hook without re-running the search. This
 * is what keeps navigation back to the search page cheap — otherwise every
 * remount re-triggers the pipeline (LLM + embeddings + fusion under HyDE).
 */
export function useSearch(
  libraryId: string,
  initialQuery = '',
  initial?: UseSearchInitial,
) {
  const hasInitial = !!initial && initial.query === initialQuery && initialQuery.trim().length > 0
  const [query, setQuery] = useState(initialQuery)
  const [results, setResults] = useState<SearchResult[]>(hasInitial ? initial!.results : [])
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(hasInitial)
  const [hybridWeights, setHybridWeights] = useState<HybridWeights>(DEFAULT_HYBRID_WEIGHTS)
  const [maxResults, setMaxResults] = useState(DEFAULT_MAX_RESULTS)
  const [minScore, setMinScore] = useState(DEFAULT_MIN_SCORE)
  const [llmMaxTokens, setLlmMaxTokens] = useState(LLM_MAX_TOKENS)
  const abortRef = useRef(0)
  // When hydrated with initial results, mark the initial search as already
  // done so the mount effect below doesn't re-fire the pipeline.
  const initialSearchDone = useRef(hasInitial)
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

      // Mark before firing the pipeline so the "initial URL query" useEffect
      // below doesn't double-fire when handleSearch also calls setSearchParams
      // (URL update → initialQuery changes → effect sees !initialSearchDone
      // and would run performSearch again, duplicating the whole pipeline).
      initialSearchDone.current = true

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

  // Re-run search when the user changes search config (weights, maxResults,
  // minScore). Gated by a "user changed config" ref instead of `hasSearched`,
  // because `hasSearched` starts true when we hydrate from route state — we
  // must not re-run on that first mount. The ref flips only via the handlers
  // below, so preference-loading effects can't accidentally trigger a search.
  const configChangedByUser = useRef(false)
  useEffect(() => {
    if (!configChangedByUser.current) return
    if (query.trim() && hasSearched) {
      performSearch(query)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hybridWeights, maxResults, minScore])

  const handleSetHybridWeights = useCallback((weights: HybridWeights) => {
    configChangedByUser.current = true
    setHybridWeights(weights)
    libraryService.updateSearchPreferences(libraryId, { ...prefsRef.current, hybridWeights: weights })
  }, [libraryId])

  const handleSetMaxResults = useCallback((n: number) => {
    configChangedByUser.current = true
    setMaxResults(n)
    libraryService.updateSearchPreferences(libraryId, { ...prefsRef.current, maxResults: n })
  }, [libraryId])

  const handleSetMinScore = useCallback((n: number) => {
    configChangedByUser.current = true
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
