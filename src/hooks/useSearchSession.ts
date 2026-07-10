import { useReducer, useRef, useState, useEffect, useCallback } from 'react'
import { useSearch } from '@/hooks/useSearch'
import { useLLMAnswer } from '@/hooks/useLLMAnswer'
import { LLM_CONTEXT_CHUNKS } from '@/lib/constants'
import type { LLMCitation } from '@/services/llm/llm.service'
import type { SearchResult, HybridWeights } from '@/types/search'
import type { SearchPreferences } from '@/types/library'

/** A completed AI answer, persisted to router state so it survives navigation. */
export interface SavedAi {
  answer: string
  citations: LLMCitation[]
  query: string
  llmMaxTokens: number
}

/**
 * Phases of the search → (AI) pipeline. Exactly one is active at a time, which
 * is what makes "don't start the next step until the current one finishes,
 * unless cancelled" hold: transitions only happen through the reducer.
 *
 *   idle → searching → searched
 *                    ↘ loadingModel → generating → answered
 */
type Phase =
  | 'idle'
  | 'searching'
  | 'searched'
  | 'loadingModel'
  | 'generating'
  | 'answered'

type Action =
  | { type: 'SEARCH' }
  | { type: 'SEARCH_SETTLED'; next: 'idle' | 'searched' | 'loadingModel' | 'generating' }
  | { type: 'MODEL_SETTLED'; next: 'idle' | 'searched' | 'generating' }
  | { type: 'GEN_SETTLED' }
  | { type: 'REGEN' }
  | { type: 'SET_AI'; next: Phase }

interface MachineState {
  phase: Phase
  /** Bumped on every SEARCH so the runner re-fires even for back-to-back searches (phase stays 'searching'). */
  nonce: number
}

/**
 * Pure transition table. Guards ensure a completion action is ignored unless it
 * matches the phase that launched it (e.g. a stale GEN_SETTLED after the user
 * cancelled AI does nothing), which is how out-of-order async results are dropped.
 */
function reducer(state: MachineState, action: Action): MachineState {
  switch (action.type) {
    case 'SEARCH':
      return { phase: 'searching', nonce: state.nonce + 1 }
    case 'SEARCH_SETTLED':
      return state.phase === 'searching' ? { ...state, phase: action.next } : state
    case 'MODEL_SETTLED':
      return state.phase === 'loadingModel' ? { ...state, phase: action.next } : state
    case 'GEN_SETTLED':
      return state.phase === 'generating' ? { ...state, phase: 'answered' } : state
    case 'REGEN':
      return state.phase === 'searched' || state.phase === 'answered'
        ? { ...state, phase: 'generating' }
        : state
    case 'SET_AI':
      // User-driven; allowed from any phase.
      return { ...state, phase: action.next }
    default:
      return state
  }
}

/** Stable key for the doc+chunk pairs in a context window, plus the token budget. */
function contextSignature(
  items: Array<Pick<SearchResult | LLMCitation, 'documentId' | 'chunkId'>>,
  maxTokens: number,
): string {
  return `${items.map((i) => `${i.documentId}:${i.chunkId}`).join(',')}|${maxTokens}`
}

interface SessionOptions {
  /** Whether the embedding model is ready — gates the initial (URL/state) search. */
  embeddingReady: boolean
  /** Query from URL or nav state to run once on load. */
  initialQuery: string
  /** A restored answer whose query matches initialQuery, or undefined. */
  savedAi?: SavedAi
  /** Focused chunk restored from nav state. */
  initialFocusedChunkId?: string | null
  /** Persisted search preferences from the route loader; seed the search hook. */
  initialPrefs?: SearchPreferences | null
}

/**
 * Orchestrates the search page as a small state machine. It coordinates the two
 * executor hooks (useSearch, useLLMAnswer) — deciding *when* each runs — while
 * they keep owning *how* they run. A single "runner" effect performs the async
 * work for the current phase; thin edge effects translate external changes
 * (prefs loaded, model status, config edits) into actions.
 */
export function useSearchSession(libraryId: string, opts: SessionOptions) {
  const { embeddingReady, initialQuery } = opts
  const search = useSearch(libraryId, opts.initialPrefs)
  const llm = useLLMAnswer(
    opts.savedAi
      ? {
          answer: opts.savedAi.answer,
          citations: opts.savedAi.citations,
          answeredQuery: opts.savedAi.query,
        }
      : {},
  )

  const [{ phase, nonce }, dispatch] = useReducer(reducer, {
    phase: 'idle',
    nonce: 0,
  })
  const [focusedChunkId, setFocusedChunkId] = useState(opts.initialFocusedChunkId ?? null)
  const [showModelModal, setShowModelModal] = useState(false)

  // The query a pending SEARCH should run (set right before dispatching SEARCH).
  const pendingQueryRef = useRef(initialQuery)
  // Invalidates in-flight async jobs: a completion is applied only if its id is still current.
  const runIdRef = useRef(0)
  // Signature of the context last sent to the LLM; lets us skip regeneration when
  // the query, chunks and token budget are unchanged (e.g. restored from nav).
  const prevContextSigRef = useRef(
    opts.savedAi ? contextSignature(opts.savedAi.citations, opts.savedAi.llmMaxTokens) : '',
  )
  const initialSearchDoneRef = useRef(false)

  // --- Always-current snapshots, so effects/callbacks never read stale values. ---
  const live = useRef({} as {
    results: SearchResult[]
    hasSearched: boolean
    query: string
    isAiMode: boolean
    llmStatus: string
    answer: string
    answeredQuery: string
    llmMaxTokens: number
    doSearch: typeof search.search
    doGenerate: typeof llm.generate
    doClearAnswer: typeof llm.clear
    doLoadModel: typeof llm.loadModel
    doToggleAi: typeof llm.toggleAiMode
    doSetHybridWeights: typeof search.setHybridWeights
    doSetMaxResults: typeof search.setMaxResults
    doSetMinScore: typeof search.setMinScore
    doSetLlmMaxTokens: typeof search.setLlmMaxTokens
  })
  live.current = {
    results: search.results,
    hasSearched: search.hasSearched,
    query: search.query,
    isAiMode: llm.isAiMode,
    llmStatus: llm.llmStatus,
    answer: llm.answer,
    answeredQuery: llm.answeredQuery,
    llmMaxTokens: search.llmMaxTokens,
    doSearch: search.search,
    doGenerate: llm.generate,
    doClearAnswer: llm.clear,
    doLoadModel: llm.loadModel,
    doToggleAi: llm.toggleAiMode,
    doSetHybridWeights: search.setHybridWeights,
    doSetMaxResults: search.setMaxResults,
    doSetMinScore: search.setMinScore,
    doSetLlmMaxTokens: search.setLlmMaxTokens,
  }
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  // ---- Runner: performs the async work for the current phase. ----
  useEffect(() => {
    const l = live.current
    if (phase === 'searching') {
      const id = ++runIdRef.current
      const q = pendingQueryRef.current
      l.doSearch(q).then((results) => {
        if (id !== runIdRef.current) return
        if (!q.trim()) {
          l.doClearAnswer()
          dispatch({ type: 'SEARCH_SETTLED', next: 'idle' })
        } else if (results.length === 0) {
          l.doClearAnswer()
          dispatch({ type: 'SEARCH_SETTLED', next: 'searched' })
        } else if (!l.isAiMode) {
          dispatch({ type: 'SEARCH_SETTLED', next: 'searched' })
        } else {
          dispatch({
            type: 'SEARCH_SETTLED',
            next: l.llmStatus === 'ready' ? 'generating' : 'loadingModel',
          })
        }
      })
    } else if (phase === 'loadingModel') {
      // loadModel owns its own progress toast (see useLLMAnswer).
      l.doLoadModel()
      // Transition happens in the llmStatus edge effect once loading settles.
    } else if (phase === 'generating') {
      const q = l.query
      const results = l.results
      const sig = contextSignature(results.slice(0, LLM_CONTEXT_CHUNKS), l.llmMaxTokens)
      // Already have this exact answer (restored from nav) — skip regeneration.
      if (l.answer && l.answeredQuery === q && sig === prevContextSigRef.current) {
        dispatch({ type: 'GEN_SETTLED' })
        return
      }
      prevContextSigRef.current = sig
      const id = ++runIdRef.current
      l.doGenerate(q, results, l.llmMaxTokens).finally(() => {
        if (id === runIdRef.current) dispatch({ type: 'GEN_SETTLED' })
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, nonce])

  // ---- Edge detectors: react to genuinely external/async signals only. ----
  // (Changes the session itself causes — config edits, AI toggle — are dispatched
  // straight from their command handlers below, so they need no watching effect.)

  // Bootstrap: prefs are already seeded by the route loader, so once the embedding
  // model is ready either run the initial (URL/state) query or preload the LLM if
  // AI mode was left on. Fires again if embeddingReady flips true after mount.
  useEffect(() => {
    const l = live.current
    if (embeddingReady && initialQuery.trim() && !initialSearchDoneRef.current) {
      initialSearchDoneRef.current = true
      pendingQueryRef.current = initialQuery
      dispatch({ type: 'SEARCH' })
    } else if (l.isAiMode && l.llmStatus === 'idle') {
      dispatch({ type: 'SET_AI', next: 'loadingModel' })
    }
  }, [embeddingReady, initialQuery])

  // The model (a shared singleton) finished or failed loading while we waited on it.
  useEffect(() => {
    if (phaseRef.current !== 'loadingModel') return
    const l = live.current
    if (llm.llmStatus === 'ready') {
      dispatch({
        type: 'MODEL_SETTLED',
        next: l.results.length > 0 && l.isAiMode ? 'generating' : l.hasSearched ? 'searched' : 'idle',
      })
    } else if (llm.llmStatus === 'error') {
      dispatch({ type: 'MODEL_SETTLED', next: l.hasSearched ? 'searched' : 'idle' })
    }
  }, [llm.llmStatus, phase])

  // ---- Command handlers exposed to the page. ----

  const submitQuery = useCallback((q: string) => {
    setFocusedChunkId(null)
    pendingQueryRef.current = q
    dispatch({ type: 'SEARCH' })
  }, [])

  const toggleAi = useCallback(() => {
    const l = live.current
    if (l.isAiMode) {
      // Turn off: cancel any generation and drop back to plain results.
      l.doToggleAi()
      l.doClearAnswer()
      dispatch({ type: 'SET_AI', next: l.hasSearched ? 'searched' : 'idle' })
    } else if (l.llmStatus === 'ready') {
      // Model already downloaded: enable and generate immediately if we have results.
      l.doToggleAi()
      if (l.results.length > 0) dispatch({ type: 'SET_AI', next: 'generating' })
    } else {
      // First enable needs a download — confirm via modal.
      setShowModelModal(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const acceptModelDownload = useCallback(() => {
    setShowModelModal(false)
    live.current.doToggleAi()
    dispatch({ type: 'SET_AI', next: 'loadingModel' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cancelModelDownload = useCallback(() => setShowModelModal(false), [])

  // Config setters persist the preference AND drive the pipeline directly — the
  // change originates here, so there's no need for an effect to watch the value.
  const rerunSearch = useCallback(() => {
    const l = live.current
    if (!l.hasSearched || !l.query.trim()) return
    setFocusedChunkId(null)
    pendingQueryRef.current = l.query
    dispatch({ type: 'SEARCH' })
  }, [])

  const setHybridWeights = useCallback(
    (w: HybridWeights) => {
      live.current.doSetHybridWeights(w)
      rerunSearch()
    },
    [rerunSearch],
  )
  const setMaxResults = useCallback(
    (n: number) => {
      live.current.doSetMaxResults(n)
      rerunSearch()
    },
    [rerunSearch],
  )
  const setMinScore = useCallback(
    (n: number) => {
      live.current.doSetMinScore(n)
      rerunSearch()
    },
    [rerunSearch],
  )
  // Token budget only affects the answer, not the retrieved chunks → regenerate.
  const setLlmMaxTokens = useCallback((n: number) => {
    live.current.doSetLlmMaxTokens(n)
    const l = live.current
    if (
      l.isAiMode &&
      l.results.length > 0 &&
      (phaseRef.current === 'searched' || phaseRef.current === 'answered')
    ) {
      setFocusedChunkId(null)
      dispatch({ type: 'REGEN' })
    }
  }, [])

  return {
    phase,
    // search state + persisted-preference setters (unchanged pass-through)
    results: search.results,
    isSearching: search.isSearching,
    error: search.error,
    hasSearched: search.hasSearched,
    hybridWeights: search.hybridWeights,
    setHybridWeights,
    maxResults: search.maxResults,
    setMaxResults,
    minScore: search.minScore,
    setMinScore,
    llmMaxTokens: search.llmMaxTokens,
    setLlmMaxTokens,
    // AI answer state
    isAiMode: llm.isAiMode,
    answer: llm.answer,
    citations: llm.citations,
    answeredQuery: llm.answeredQuery,
    isGenerating: llm.isGenerating,
    llmStatus: llm.llmStatus,
    llmError: llm.llmError,
    loadError: llm.loadError,
    // page-owned UI state
    focusedChunkId,
    setFocusedChunkId,
    showModelModal,
    // commands
    submitQuery,
    toggleAi,
    acceptModelDownload,
    cancelModelDownload,
  }
}
