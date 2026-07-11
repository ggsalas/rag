import { useRef, useState, useCallback, useEffect } from 'react'
import { useSearch } from '@/hooks/useSearch'
import { useLLMAnswer } from '@/hooks/useLLMAnswer'
import type { LLMCitation } from '@/services/llm/llm.service'
import type { SearchResult, HybridWeights } from '@/types/search'
import type { SearchPreferences } from '@/types/library'
import type { ModelStatus } from '@/store/app.store'

/**
 * Complete search state persisted to router state so it survives navigation.
 * Includes both search results and optional AI answer.
 */
export interface SavedSearchState {
  query: string
  results: SearchResult[]
  focusedChunkId?: string | null
  isAiMode?: boolean
  ai?: {
    answer: string
    citations: LLMCitation[]
    llmMaxTokens: number
  }
}

/** Simple status for the search pipeline */
type Status = 'idle' | 'searching' | 'generating'

interface SessionOptions {
  /** Whether the embedding model is ready — gates the initial search. */
  embeddingReady: boolean
  /** Query from URL to run once on load (only used if no saved state). */
  initialQuery: string
  /** Restored search state from navigation (includes results + optional AI). */
  savedState?: SavedSearchState
  /** Persisted search preferences from the route loader. */
  initialPrefs?: SearchPreferences | null
}

/**
 * Orchestrates the search page with a simple async flow.
 *
 * Flow:
 *   ON_PAGE_LOAD → isPreviousSearch?
 *     yes → restore results + AI from savedState (no re-search)
 *     no  → if initialQuery → onSearch(initialQuery)
 *
 *   ON_SEARCH (submit query OR change search params):
 *     → SEARCH_CHUNKS → if AI mode → GENERATE_AI_RESPONSE
 *
 *   setLlmMaxTokens (special case):
 *     → only regenerate AI (no re-search)
 */
export function useSearchSession(
  libraryId: string,
  { embeddingReady, initialQuery, savedState, initialPrefs }: SessionOptions,
) {
  // Initialize search with restored state if available
  const search = useSearch(libraryId, initialPrefs, {
    query: savedState?.query,
    results: savedState?.results,
    isAiMode: savedState?.isAiMode,
  })

  // Initialize LLM with restored AI answer if available
  const llm = useLLMAnswer(
    savedState?.ai
      ? {
          answer: savedState.ai.answer,
          citations: savedState.ai.citations,
          answeredQuery: savedState.query,
        }
      : {},
  )

  const [status, setStatus] = useState<Status>('idle')
  const [focusedChunkId, setFocusedChunkId] = useState<string | null>(
    savedState?.focusedChunkId ?? null,
  )
  const [showModelModal, setShowModelModal] = useState(false)

  // Refs for async access (avoid stale closures)
  const runIdRef = useRef(0)
  const queryRef = useRef(savedState?.query ?? initialQuery)
  const resultsRef = useRef<SearchResult[]>(savedState?.results ?? [])

  // Fresh values ref for reading mid-async
  const stateRef = useRef<{ isAiMode: boolean; llmStatus: ModelStatus }>({
    isAiMode: search.isAiMode,
    llmStatus: llm.llmStatus,
  })
  stateRef.current = {
    isAiMode: search.isAiMode,
    llmStatus: llm.llmStatus,
  }

  // ============================================================
  // CORE: Single async function for the full search pipeline
  // ============================================================

  /** Loads the LLM model if not ready. Returns true if the model is ready after the call. */
  const ensureModelReady = useCallback(async (): Promise<boolean> => {
    if (stateRef.current.llmStatus === 'ready') return true
    await llm.loadModel()
    return (stateRef.current.llmStatus as ModelStatus) === 'ready'
  }, [llm])

  const onSearch = useCallback(
    async (query: string) => {
      const jobId = ++runIdRef.current
      queryRef.current = query

      // Empty query → clear everything
      if (!query.trim()) {
        search.clearResults()
        llm.clear()
        resultsRef.current = []
        setStatus('idle')
        return
      }

      // 1. Search chunks
      setStatus('searching')
      setFocusedChunkId(null)

      const searchResults = await search.search(query)

      // Stale check
      if (jobId !== runIdRef.current) return

      resultsRef.current = searchResults

      // No results → done
      if (searchResults.length === 0) {
        llm.clear()
        setStatus('idle')
        return
      }

      // Check AI mode (read fresh value)
      const { isAiMode } = stateRef.current

      if (!isAiMode) {
        setStatus('idle')
        return
      }

      // 2. Load LLM model if needed
      const modelReady = await ensureModelReady()
      if (jobId !== runIdRef.current) return
      if (!modelReady) {
        setStatus('idle')
        return
      }

      // 3. Generate AI response
      setStatus('generating')

      await llm.generate(query, searchResults, search.llmMaxTokens)

      // Stale check
      if (jobId !== runIdRef.current) return

      setStatus('idle')
    },
    [search, llm, ensureModelReady],
  )

  // ============================================================
  // REGENERATE: Only for token budget changes (no re-search)
  // ============================================================

  const regenerateAi = useCallback(
    async (maxTokens: number) => {
      const query = queryRef.current
      const results = resultsRef.current

      if (!query.trim() || results.length === 0) return
      if (!stateRef.current.isAiMode) return

      const jobId = ++runIdRef.current

      // Load model if needed
      const modelReady = await ensureModelReady()
      if (jobId !== runIdRef.current) return
      if (!modelReady) return

      setStatus('generating')
      setFocusedChunkId(null)

      await llm.generate(query, results, maxTokens)

      if (jobId !== runIdRef.current) return

      setStatus('idle')
    },
    [llm, ensureModelReady],
  )

  // ============================================================
  // BOOTSTRAP: Run once when embedding model becomes ready
  // ============================================================

  const bootstrapDoneRef = useRef(false)
  useEffect(() => {
    if (!embeddingReady || bootstrapDoneRef.current) return
    bootstrapDoneRef.current = true

    if (!savedState && initialQuery.trim()) {
      onSearch(initialQuery)
    }

    // Preload LLM if AI mode is on (loadModel is a no-op if already ready/loading)
    if (search.isAiMode && llm.llmStatus === 'idle') {
      llm.loadModel()
    }
  }, [embeddingReady, savedState, initialQuery, onSearch, search.isAiMode, llm])

  // ============================================================
  // HANDLERS
  // ============================================================

  const submitQuery = useCallback(
    (query: string) => {
      onSearch(query)
    },
    [onSearch],
  )

  const toggleAi = useCallback(() => {
    if (search.isAiMode) {
      // Turn off AI
      search.setIsAiMode(false)
      llm.clear()
    } else if (llm.llmStatus === 'ready') {
      // Turn on AI (model already loaded)
      search.setIsAiMode(true)
      // Re-search to generate AI response if we have a query
      const query = queryRef.current
      if (query.trim() && resultsRef.current.length > 0) {
        onSearch(query)
      }
    } else {
      // Need to download model first — show confirmation modal
      setShowModelModal(true)
    }
  }, [search, llm, onSearch])

  const acceptModelDownload = useCallback(() => {
    setShowModelModal(false)
    search.setIsAiMode(true)
    // Run search which will load model and generate
    const query = queryRef.current
    if (query.trim()) {
      onSearch(query)
    } else {
      // No query yet, just preload the model
      llm.loadModel()
    }
  }, [search, llm, onSearch])

  const cancelModelDownload = useCallback(() => setShowModelModal(false), [])

  // Config setters: update preference and re-search
  const setHybridWeights = useCallback(
    (weights: HybridWeights) => {
      search.setHybridWeights(weights)
      const query = queryRef.current
      if (query.trim() && search.hasSearched) {
        onSearch(query)
      }
    },
    [search, onSearch],
  )

  const setMaxResults = useCallback(
    (count: number) => {
      search.setMaxResults(count)
      const query = queryRef.current
      if (query.trim() && search.hasSearched) {
        onSearch(query)
      }
    },
    [search, onSearch],
  )

  const setMinScore = useCallback(
    (score: number) => {
      search.setMinScore(score)
      const query = queryRef.current
      if (query.trim() && search.hasSearched) {
        onSearch(query)
      }
    },
    [search, onSearch],
  )

  // Token budget: only regenerate AI, don't re-search
  const setLlmMaxTokens = useCallback(
    (tokens: number) => {
      search.setLlmMaxTokens(tokens)
      if (stateRef.current.isAiMode && resultsRef.current.length > 0) {
        regenerateAi(tokens)
      }
    },
    [search, regenerateAi],
  )

  // ============================================================
  // RETURN
  // ============================================================

  return {
    // Status (replaces phase)
    status,
    isSearching: status === 'searching',
    isGenerating: status === 'generating' || llm.isGenerating,

    // Search state
    results: search.results,
    error: search.error,
    hasSearched: search.hasSearched,

    // Search preferences
    hybridWeights: search.hybridWeights,
    setHybridWeights,
    maxResults: search.maxResults,
    setMaxResults,
    minScore: search.minScore,
    setMinScore,
    llmMaxTokens: search.llmMaxTokens,
    setLlmMaxTokens,

    // AI answer state
    isAiMode: search.isAiMode,
    answer: llm.answer,
    citations: llm.citations,
    answeredQuery: llm.answeredQuery,
    llmError: llm.llmError,

    // UI state
    focusedChunkId,
    setFocusedChunkId,
    showModelModal,

    // Commands
    submitQuery,
    toggleAi,
    acceptModelDownload,
    cancelModelDownload,
  }
}
