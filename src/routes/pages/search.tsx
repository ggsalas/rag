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
import type { SearchPreferences } from '@/types/library'
import {
  createSearchStore,
  ensureModelLoaded,
  type SavedSearchState,
  type SearchStore,
  type PipelineOptions,
} from '@/hooks/useSearchStore'
import { useSearchPreferences } from '@/hooks/useSearchPreferences'
import { useOramaHydration } from '@/hooks/useOramaHydration'
import { SearchBar } from '@/components/search/SearchBar'
import { ResultList } from '@/components/search/ResultList'
import { LLMAnswer } from '@/components/search/LLMAnswer'
import { ModelDownloadModal } from '@/components/search/ModelDownloadModal'
import { MainPanel } from '@/components/sidebar/MainPanel'

interface LocationState {
  savedSearchState?: SavedSearchState
}

interface SearchLoaderData {
  searchPreferences: SearchPreferences | null
}

/**
 * Loads persisted search preferences before the page renders, so the search
 * hooks can seed their state synchronously — no post-mount fetch and no flash
 * of defaults. React Router re-runs this whenever :libraryId changes.
 */
export async function searchLoader({
  params,
}: LoaderFunctionArgs): Promise<SearchLoaderData> {
  const library = await libraryService.getLibraryById(params.libraryId!)
  return { searchPreferences: library?.searchPreferences ?? null }
}

/**
 * Only revalidate (reload prefs) when the library changes, so same-library
 * navigations stay synchronous.
 */
export const searchShouldRevalidate: ShouldRevalidateFunction = ({
  currentParams,
  nextParams,
}) => currentParams.libraryId !== nextParams.libraryId

export function SearchPage() {
  const { libraryId } = useParams<{ libraryId: string }>()
  const { searchPreferences } = useLoaderData() as SearchLoaderData
  const embeddingStatus = useAppStore((s) => s.embeddingStatus)
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()

  useOramaHydration(libraryId)

  const locationState = (location.state ?? {}) as LocationState
  const urlQuery = searchParams.get('q') || ''

  // Restore state from navigation if query matches
  const savedState =
    locationState.savedSearchState?.query === urlQuery
      ? locationState.savedSearchState
      : undefined

  // --- Store (page-scoped, created once) ---
  const storeRef = useRef<SearchStore | null>(null)
  if (!storeRef.current) {
    storeRef.current = createSearchStore(savedState)
  }
  const store = storeRef.current

  const { status, results, answer, citations, error, llmError, hasSearched } =
    useStore(store)

  // --- Preferences (separate from pipeline state) ---
  const prefs = useSearchPreferences(libraryId!, searchPreferences)

  // --- Local UI state ---
  const [showModelModal, setShowModelModal] = useState(false)

  // focusedChunkId lives in location.state for back-nav persistence
  const focusedChunkId = locationState.savedSearchState?.focusedChunkId ?? null

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

  // --- Pipeline options (built from current prefs) ---
  const buildOpts = useCallback(
    (): PipelineOptions => ({
      libraryId: libraryId!,
      isAiMode: prefs.isAiMode,
      hybridWeights: prefs.hybridWeights,
      maxResults: prefs.maxResults,
      minScore: prefs.minScore,
      llmMaxTokens: prefs.llmMaxTokens,
    }),
    [
      libraryId,
      prefs.isAiMode,
      prefs.hybridWeights,
      prefs.maxResults,
      prefs.minScore,
      prefs.llmMaxTokens,
    ],
  )

  // --- onSettled: persist complete state to router on pipeline completion ---
  const onSettled = useCallback(
    (state: SavedSearchState) => {
      navigate(location.pathname + '?q=' + encodeURIComponent(state.query), {
        replace: true,
        state: { savedSearchState: state },
      })
    },
    [navigate, location.pathname],
  )

  // --- Bootstrap: auto-search if ?q= exists with no saved state ---
  const bootstrappedRef = useRef(false)
  useEffect(() => {
    if (bootstrappedRef.current) return
    if (!urlQuery.trim() || savedState) return
    if (embeddingStatus !== 'ready') return

    bootstrappedRef.current = true
    store.getState().submitQuery(urlQuery, buildOpts(), onSettled)
  }, [embeddingStatus, urlQuery, savedState, store, buildOpts, onSettled])

  // --- Cleanup on unmount ---
  useEffect(
    () => () => {
      storeRef.current?.getState().destroy()
    },
    [],
  )

  // --- Preload LLM if AI mode is already enabled ---
  useEffect(() => {
    if (!prefs.isAiMode) return
    if (useAppStore.getState().llmStatus !== 'idle') return
    ensureModelLoaded(new AbortController().signal)
  }, [prefs.isAiMode])

  // --- Handlers (event-driven, no effects) ---
  const handleSearch = useCallback(
    (query: string) => {
      const trimmed = query.trim()
      setSearchParams(trimmed ? { q: query } : {})
      store.getState().submitQuery(query, buildOpts(), onSettled)
    },
    [setSearchParams, store, buildOpts, onSettled],
  )

  const handleSetHybridWeights = useCallback(
    (weights: typeof prefs.hybridWeights) => {
      prefs.setHybridWeights(weights)
      if (hasSearched && urlQuery.trim()) {
        store.getState().submitQuery(
          urlQuery,
          {
            ...buildOpts(),
            hybridWeights: weights,
          },
          onSettled,
        )
      }
    },
    [prefs, hasSearched, urlQuery, store, buildOpts, onSettled],
  )

  const handleSetMaxResults = useCallback(
    (n: number) => {
      prefs.setMaxResults(n)
      if (hasSearched && urlQuery.trim()) {
        store.getState().submitQuery(
          urlQuery,
          {
            ...buildOpts(),
            maxResults: n,
          },
          onSettled,
        )
      }
    },
    [prefs, hasSearched, urlQuery, store, buildOpts, onSettled],
  )

  const handleSetMinScore = useCallback(
    (n: number) => {
      prefs.setMinScore(n)
      if (hasSearched && urlQuery.trim()) {
        store.getState().submitQuery(
          urlQuery,
          {
            ...buildOpts(),
            minScore: n,
          },
          onSettled,
        )
      }
    },
    [prefs, hasSearched, urlQuery, store, buildOpts, onSettled],
  )

  const handleSetLlmMaxTokens = useCallback(
    (n: number) => {
      prefs.setLlmMaxTokens(n)
      // Token budget change → regenerate AI only (no re-search)
      if (prefs.isAiMode && results.length > 0 && urlQuery.trim()) {
        store.getState().regenerateAnswer(
          urlQuery,
          results,
          {
            ...buildOpts(),
            llmMaxTokens: n,
          },
          onSettled,
        )
      }
    },
    [prefs, results, urlQuery, store, buildOpts, onSettled],
  )

  const toggleAi = useCallback(() => {
    if (prefs.isAiMode) {
      // Turn off AI
      prefs.setIsAiMode(false)
    } else {
      const llmStatus = useAppStore.getState().llmStatus
      if (llmStatus === 'ready') {
        // Turn on AI (model already loaded) — re-search to generate
        prefs.setIsAiMode(true)
        if (hasSearched && urlQuery.trim()) {
          store.getState().submitQuery(
            urlQuery,
            {
              ...buildOpts(),
              isAiMode: true,
            },
            onSettled,
          )
        }
      } else {
        // Need to download model first — show confirmation modal
        setShowModelModal(true)
      }
    }
  }, [prefs, hasSearched, urlQuery, store, buildOpts, onSettled])

  const acceptModelDownload = useCallback(() => {
    setShowModelModal(false)
    prefs.setIsAiMode(true)
    if (urlQuery.trim()) {
      store.getState().submitQuery(
        urlQuery,
        {
          ...buildOpts(),
          isAiMode: true,
        },
        onSettled,
      )
    }
  }, [prefs, urlQuery, store, buildOpts, onSettled])

  const cancelModelDownload = useCallback(() => setShowModelModal(false), [])

  // --- Derived state ---
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
