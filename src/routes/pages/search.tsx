import {
  useParams,
  useSearchParams,
  useLocation,
  useNavigate,
  useLoaderData,
  type LoaderFunctionArgs,
  type ShouldRevalidateFunction,
} from 'react-router'
import { useEffect, useRef, useCallback, useState } from 'react'
import { useStore } from 'zustand'
import { useAppStore } from '@/store/app.store'
import * as libraryService from '@/services/library.service'
import { ensureIndex } from '@/services/embedding/vector-store'
import {
  ensureModelLoaded,
  type ModelLoadCallbacks,
} from '@/services/llm/llm.service'
import type { SearchPreferences } from '@/types/library'
import type {
  SavedSearchState,
  PipelineOptions,
} from '@/types/search'
import {
  createSearchStore,
  type SearchStore,
} from '@/hooks/useSearchStore'
import { useSearchPreferences } from '@/hooks/useSearchPreferences'
import { SearchBar } from '@/components/search/SearchBar'
import { ResultList } from '@/components/search/ResultList'
import { LLMAnswer } from '@/components/search/LLMAnswer'
import { ModelDownloadModal } from '@/components/search/ModelDownloadModal'
import { ModelDownloadToast } from '@/components/search/ModelDownloadToast'
import { MainPanel } from '@/components/sidebar/MainPanel'
import { toast } from 'sonner'

/** Stable id so the progress toast and its success/error transition target the same toast. */
const LLM_DOWNLOAD_TOAST_ID = 'llm-model-download'

/** Creates model load callbacks for LLM service */
function getLlmModelCallbacks(): ModelLoadCallbacks {
  return {
    getStatus: () => useAppStore.getState().llmStatus,
    setStatus: (s) => useAppStore.getState().setLlmStatus(s as any),
    setProgress: (p) => useAppStore.getState().setLlmProgress(p),
    subscribe: (listener) => useAppStore.subscribe((state) => listener(state.llmStatus)),
    showToast: () => toast(<ModelDownloadToast model="llm" />, { id: LLM_DOWNLOAD_TOAST_ID, duration: Infinity }),
    dismissToast: () => toast.dismiss(LLM_DOWNLOAD_TOAST_ID),
    showErrorToast: (msg) => toast.error(msg, { id: LLM_DOWNLOAD_TOAST_ID, duration: 6000 }),
  }
}

interface LocationState {
  savedSearchState?: SavedSearchState
}

interface SearchLoaderData {
  searchPreferences: SearchPreferences | null
}

/**
 * Prepares the search page before rendering:
 * - Ensures the Orama vector index is hydrated for the library.
 * - Loads persisted search preferences so hooks seed state synchronously.
 * React Router re-runs this whenever :libraryId changes.
 */
export async function searchLoader({
  params,
}: LoaderFunctionArgs): Promise<SearchLoaderData> {
  await ensureIndex(params.libraryId!)

  const library = await libraryService.getLibraryById(params.libraryId!)

  return { searchPreferences: library?.searchPreferences ?? null }
}

/** Only revalidate route when library changes. Same-library navigations stay synchronous. */
export const searchShouldRevalidate: ShouldRevalidateFunction = ({
  currentParams,
  nextParams,
}) => currentParams.libraryId !== nextParams.libraryId

export function SearchPage() {
  // -- Pipeline overview --
  // ?q= → submitQuery → vector search → optionally LLM streaming → idle
  // On completion, state is saved to location.state for back-nav restoration.

  // -- Route state (URL + navigation history) --
  const { libraryId } = useParams<{ libraryId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { searchPreferences } = useLoaderData() as SearchLoaderData
  const locationState = (location.state ?? {}) as LocationState
  const urlQuery = searchParams.get('q') || ''
  // Restore state from navigation if query matches
  const savedState =
    locationState.savedSearchState?.query === urlQuery
      ? locationState.savedSearchState
      : undefined
  const focusedChunkId = locationState.savedSearchState?.focusedChunkId ?? null

  // -- Search pipeline state (page-scoped Zustand store) --
  // Zustand's createStore (not a global singleton) gives us get() for stale-free
  // reads in async pipelines and selective subscriptions for streaming re-renders.
  const storeRef = useRef<SearchStore | null>(null)
  if (!storeRef.current) {
    storeRef.current = createSearchStore(savedState, getLlmModelCallbacks())
  }
  const store = storeRef.current

  const { status, results, answer, citations, error, llmError, hasSearched } =
    useStore(store)

  // -- Preferences (persisted per-library in IndexedDB) --
  const prefs = useSearchPreferences(libraryId!, searchPreferences)

  // -- Global app state --
  const embeddingStatus = useAppStore((s) => s.embeddingStatus)

  // -- Local UI state --
  const [showModelModal, setShowModelModal] = useState(false)

  // ─── Pipeline helpers ───
  const pipelineOpts: PipelineOptions = {
    libraryId: libraryId!,
    isAiMode: prefs.isAiMode,
    hybridWeights: prefs.hybridWeights,
    maxResults: prefs.maxResults,
    minScore: prefs.minScore,
    llmMaxTokens: prefs.llmMaxTokens,
  }

  const onSettled = useCallback(
    (state: SavedSearchState) => {
      navigate(location.pathname + '?q=' + encodeURIComponent(state.query), {
        replace: true,
        state: { savedSearchState: state },
      })
    },
    [navigate, location.pathname],
  )

  /** Re-runs the current query with overridden pipeline options */
  const reSearchWithOverride = useCallback(
    (overrides: Partial<PipelineOptions>) => {
      if (hasSearched && urlQuery.trim()) {
        store
          .getState()
          .submitQuery(urlQuery, { ...pipelineOpts, ...overrides }, onSettled)
      }
    },
    [hasSearched, urlQuery, store, pipelineOpts, onSettled],
  )

  // -- Handlers --
  const handleSearch = useCallback(
    (query: string) => {
      const trimmed = query.trim()
      setSearchParams(trimmed ? { q: query } : {})
      store.getState().submitQuery(query, pipelineOpts, onSettled)
    },
    [setSearchParams, store, pipelineOpts, onSettled],
  )

  const setFocusedChunkId = useCallback(
    (id: string | null) => {
      navigate(location.pathname + location.search, {
        replace: true,
        state: {
          savedSearchState: {
            ...locationState.savedSearchState,
            focusedChunkId: id,
          },
        },
      })
    },
    [
      navigate,
      location.pathname,
      location.search,
      locationState.savedSearchState,
    ],
  )

  // Pref changes: update local + persist to IndexedDB, re-search if active query
  const handleSetHybridWeights = useCallback(
    (weights: typeof prefs.hybridWeights) => {
      prefs.setHybridWeights(weights)
      reSearchWithOverride({ hybridWeights: weights })
    },
    [prefs, reSearchWithOverride],
  )

  const handleSetMaxResults = useCallback(
    (n: number) => {
      prefs.setMaxResults(n)
      reSearchWithOverride({ maxResults: n })
    },
    [prefs, reSearchWithOverride],
  )

  const handleSetMinScore = useCallback(
    (n: number) => {
      prefs.setMinScore(n)
      reSearchWithOverride({ minScore: n })
    },
    [prefs, reSearchWithOverride],
  )

  // Token budget → regenerate AI answer only (no re-search)
  const handleSetLlmMaxTokens = useCallback(
    (n: number) => {
      prefs.setLlmMaxTokens(n)
      // Token budget change → regenerate AI only (no re-search)
      if (prefs.isAiMode && results.length > 0 && urlQuery.trim()) {
        store.getState().regenerateAnswer(
          urlQuery,
          results,
          {
            ...pipelineOpts,
            llmMaxTokens: n,
          },
          onSettled,
        )
      }
    },
    [prefs, results, urlQuery, store, pipelineOpts, onSettled],
  )

  // -- AI toggle + model download --
  const toggleAi = useCallback(() => {
    if (prefs.isAiMode) {
      // Turn off AI
      prefs.setIsAiMode(false)
    } else {
      const llmStatus = useAppStore.getState().llmStatus
      if (llmStatus === 'ready') {
        // Turn on AI (model already loaded) — re-search to generate
        prefs.setIsAiMode(true)
        reSearchWithOverride({ isAiMode: true })
      } else {
        // Need to download model first — show confirmation modal
        setShowModelModal(true)
      }
    }
  }, [prefs, reSearchWithOverride])

  const acceptModelDownload = useCallback(() => {
    setShowModelModal(false)
    prefs.setIsAiMode(true)
    if (urlQuery.trim()) {
      store.getState().submitQuery(
        urlQuery,
        {
          ...pipelineOpts,
          isAiMode: true,
        },
        onSettled,
      )
    }
  }, [prefs, urlQuery, store, pipelineOpts, onSettled])

  const cancelModelDownload = useCallback(() => setShowModelModal(false), [])

  // -- Effects --
  // Bootstrap: auto-search if ?q= exists with no saved state
  const bootstrappedRef = useRef(false)
  useEffect(() => {
    if (bootstrappedRef.current) return
    if (!urlQuery.trim() || savedState) return
    if (embeddingStatus !== 'ready') return

    bootstrappedRef.current = true
    store.getState().submitQuery(urlQuery, pipelineOpts, onSettled)
  }, [embeddingStatus, urlQuery, savedState, store, pipelineOpts, onSettled])

  // Cleanup on unmount
  useEffect(
    () => () => {
      storeRef.current?.getState().destroy()
    },
    [],
  )

  // Preload LLM if AI mode is already enabled
  useEffect(() => {
    if (!prefs.isAiMode) return
    if (useAppStore.getState().llmStatus !== 'idle') return
    ensureModelLoaded(new AbortController().signal, getLlmModelCallbacks())
  }, [prefs.isAiMode])

  // -- Derived (render-only) --
  const isSearching = status === 'searching'
  const isGenerating = status === 'generating'
  const showLLMAnswer =
    prefs.isAiMode && (isGenerating || !!answer || !!llmError)

  // Build state to pass when navigating to document viewer
  const currentSavedState: SavedSearchState | undefined =
    hasSearched && results.length > 0
      ? {
          query: urlQuery,
          results,
          focusedChunkId,
          ai: !isGenerating && answer ? { answer, citations } : undefined,
        }
      : undefined

  return (
    <MainPanel>
      <div className="flex-1 overflow-y-auto p-6">
        <SearchBar
          onSearch={handleSearch}
          isSearching={isSearching}
          embeddingStatus={embeddingStatus}
          initialQuery={urlQuery}
          hybridWeights={prefs.hybridWeights}
          onWeightsChange={handleSetHybridWeights}
          maxResults={prefs.maxResults}
          onMaxResultsChange={handleSetMaxResults}
          minScore={prefs.minScore}
          onMinScoreChange={handleSetMinScore}
          notFocused={!!focusedChunkId}
          isAiMode={prefs.isAiMode}
          onAiModeToggle={toggleAi}
          llmMaxTokens={prefs.llmMaxTokens}
          onLlmMaxTokensChange={handleSetLlmMaxTokens}
        />

        {showLLMAnswer && (
          <div className="mt-6">
            <LLMAnswer
              answer={answer}
              citations={citations}
              isGenerating={isGenerating}
              error={llmError}
              onCitationClick={(c) => setFocusedChunkId(c.chunkId)}
            />
          </div>
        )}

        <div className="mt-6">
          <ResultList
            results={results}
            isSearching={isSearching}
            hasSearched={hasSearched}
            error={error}
            focusedChunkId={focusedChunkId}
            savedSearchState={currentSavedState}
            citations={prefs.isAiMode ? citations : undefined}
          />
        </div>
      </div>

      <ModelDownloadModal
        open={showModelModal}
        onAccept={acceptModelDownload}
        onCancel={cancelModelDownload}
      />
    </MainPanel>
  )
}
