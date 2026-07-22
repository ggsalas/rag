import { createStore, type StoreApi } from 'zustand/vanilla'
import { search as searchService } from '@/services/search/search.service'
import {
  generateAnswer,
  abortLLMGeneration,
  ensureModelLoaded,
  type ModelLoadCallbacks,
} from '@/services/llm/llm.service'
import type { LLMCitation } from '@/services/llm/llm.service'
import type {
  SearchResult,
  SavedSearchState,
  PipelineOptions,
  OnSettledCallback,
} from '@/types/search'

export interface SearchPipelineState {
  // --- State ---
  status: 'idle' | 'searching' | 'generating'
  results: SearchResult[]
  answer: string
  citations: LLMCitation[]
  error: string | null
  llmError: string | null
  hasSearched: boolean

  // --- Actions ---
  submitQuery: (
    query: string,
    opts: PipelineOptions,
    onSettled?: OnSettledCallback,
  ) => void
  regenerateAnswer: (
    query: string,
    results: SearchResult[],
    opts: PipelineOptions,
    onSettled?: OnSettledCallback,
  ) => void
  clear: () => void
  destroy: () => void
}

// Internal state not exposed to consumers
interface InternalSlice {
  _abort: AbortController | null
  _query: string
}

type FullState = SearchPipelineState & InternalSlice

/** Creates a page-scoped search pipeline store */
export function createSearchStore(savedState?: SavedSearchState, modelCallbacks?: ModelLoadCallbacks) {
  return createStore<FullState>((set, get) => ({
    // --- Initial State (hydrate from savedState if available) ---
    status: 'idle',
    results: savedState?.results ?? [],
    answer: savedState?.ai?.answer ?? '',
    citations: savedState?.ai?.citations ?? [],
    error: null,
    llmError: null,
    hasSearched: (savedState?.results?.length ?? 0) > 0,

    // --- Internal ---
    _abort: null,
    _query: savedState?.query ?? '',

    // --- Actions ---

    submitQuery: (query, opts, onSettled) => {
      const { _abort: prevAbort } = get()
      prevAbort?.abort()

      const trimmed = query.trim()

      // Empty query → clear everything
      if (!trimmed) {
        set({
          _abort: null,
          _query: '',
          status: 'idle',
          results: [],
          answer: '',
          citations: [],
          error: null,
          llmError: null,
          hasSearched: false,
        })
        return
      }

      const ctrl = new AbortController()
      set({
        _abort: ctrl,
        _query: query,
        status: 'searching',
        error: null,
        llmError: null,
        answer: '',
        citations: [],
      })

      runSearchPipeline(ctrl, trimmed, query, opts, onSettled, set, get, modelCallbacks)
    },

    regenerateAnswer: (query, results, opts, onSettled) => {
      const { _abort: prevAbort } = get()
      prevAbort?.abort()
      abortLLMGeneration()

      if (!query.trim() || results.length === 0) return

      const ctrl = new AbortController()
      set({
        _abort: ctrl,
        _query: query,
        status: 'generating',
        answer: '',
        citations: [],
        llmError: null,
      })

      runRegeneratePipeline(ctrl, query, results, opts, onSettled, set, get, modelCallbacks)
    },

    clear: () => {
      const { _abort } = get()
      _abort?.abort()
      abortLLMGeneration()
      set({
        _abort: null,
        _query: '',
        status: 'idle',
        results: [],
        answer: '',
        citations: [],
        error: null,
        llmError: null,
        hasSearched: false,
      })
    },

    destroy: () => {
      const { _abort } = get()
      _abort?.abort()
      abortLLMGeneration()
    },
  }))
}

// --- Pipeline functions ---

type SetState = StoreApi<FullState>['setState']
type GetState = StoreApi<FullState>['getState']

/** Runs the full search → optional LLM generation pipeline */
async function runSearchPipeline(
  ctrl: AbortController,
  trimmed: string,
  query: string,
  opts: PipelineOptions,
  onSettled: OnSettledCallback | undefined,
  set: SetState,
  get: GetState,
  modelCallbacks?: ModelLoadCallbacks,
): Promise<void> {
  try {
    // 1. Search chunks
    const results = await searchService(
      trimmed,
      opts.libraryId,
      opts.maxResults,
      opts.hybridWeights,
      opts.minScore,
    )
    if (ctrl.signal.aborted) return

    set({ results, hasSearched: true })

    // No results or AI mode off → done
    if (results.length === 0 || !opts.isAiMode) {
      set({ status: 'idle' })
      onSettled?.({ query, results })
      return
    }

    // 2. Ensure LLM model is loaded
    if (!modelCallbacks) {
      set({ status: 'idle' })
      onSettled?.({ query, results })
      return
    }
    const modelReady = await ensureModelLoaded(ctrl.signal, modelCallbacks)
    if (ctrl.signal.aborted) return
    if (!modelReady) {
      set({ status: 'idle' })
      onSettled?.({ query, results })
      return
    }

    // 3. Generate AI answer
    set({ status: 'generating', answer: '', citations: [] })

    const citations = await generateAnswer(
      trimmed,
      results,
      (token, done) => {
        if (ctrl.signal.aborted) return
        if (!done && token) {
          set({ answer: get().answer + token })
        }
      },
      opts.llmMaxTokens,
    )
    if (ctrl.signal.aborted) return

    set({ status: 'idle', citations })
    onSettled?.({
      query,
      results: get().results,
      ai: {
        answer: get().answer,
        citations,
      },
    })
  } catch (err) {
    if (ctrl.signal.aborted) return
    const message = err instanceof Error ? err.message : 'Search failed'
    const currentStatus = get().status
    if (currentStatus === 'generating') {
      set({ status: 'idle', llmError: message })
    } else {
      set({ status: 'idle', error: message, hasSearched: true })
    }
  }
}

/** Runs only the LLM generation pipeline (no re-search) */
async function runRegeneratePipeline(
  ctrl: AbortController,
  query: string,
  results: SearchResult[],
  opts: PipelineOptions,
  onSettled: OnSettledCallback | undefined,
  set: SetState,
  get: GetState,
  modelCallbacks?: ModelLoadCallbacks,
): Promise<void> {
  try {
    if (!modelCallbacks) {
      set({ status: 'idle' })
      return
    }
    const modelReady = await ensureModelLoaded(ctrl.signal, modelCallbacks)
    if (ctrl.signal.aborted) return
    if (!modelReady) {
      set({ status: 'idle' })
      return
    }

    const citations = await generateAnswer(
      query.trim(),
      results,
      (token, done) => {
        if (ctrl.signal.aborted) return
        if (!done && token) {
          set({ answer: get().answer + token })
        }
      },
      opts.llmMaxTokens,
    )
    if (ctrl.signal.aborted) return

    set({ status: 'idle', citations })
    onSettled?.({
      query,
      results: get().results,
      ai: {
        answer: get().answer,
        citations,
      },
    })
  } catch (err) {
    if (ctrl.signal.aborted) return
    set({
      status: 'idle',
      llmError: err instanceof Error ? err.message : 'Generation failed',
    })
  }
}

export type SearchStore = ReturnType<typeof createSearchStore>
