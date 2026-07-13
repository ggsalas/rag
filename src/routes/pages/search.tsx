import {
  useParams,
  useSearchParams,
  useLocation,
  useNavigate,
  useLoaderData,
  type LoaderFunctionArgs,
  type ShouldRevalidateFunction,
} from 'react-router'
import { useEffect, useRef } from 'react'
import { useAppStore } from '@/store/app.store'
import * as libraryService from '@/services/library.service'
import type { SearchPreferences } from '@/types/library'
import {
  useSearchSession,
  type SavedSearchState,
} from '@/hooks/useSearchSession'
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
 * navigations stay synchronous. Key case: ResultCard's pre-flight `replace` that
 * stamps `focusedChunkId` before pushing to the doc viewer — if the loader made
 * that replace async, the immediate push would cancel it before it commits, and
 * the chunk wouldn't be highlighted when navigating back.
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

  const {
    status,
    results,
    isSearching,
    isGenerating,
    error,
    hasSearched,
    hybridWeights,
    setHybridWeights,
    maxResults,
    setMaxResults,
    minScore,
    setMinScore,
    llmMaxTokens,
    setLlmMaxTokens,
    isAiMode,
    answer,
    citations,
    answeredQuery,
    llmError,
    focusedChunkId,
    setFocusedChunkId,
    showModelModal,
    submitQuery,
    toggleAi,
    acceptModelDownload,
    cancelModelDownload,
  } = useSearchSession(libraryId!, {
    embeddingReady: embeddingStatus === 'ready',
    initialQuery: urlQuery,
    savedState,
    initialPrefs: searchPreferences,
  })

  // Persist state to route when generation completes (status: generating → idle with answer)
  const prevStatusRef = useRef(status)
  useEffect(() => {
    const wasGenerating = prevStatusRef.current === 'generating'
    const isNowIdle = status === 'idle'

    if (wasGenerating && isNowIdle && answer && answeredQuery) {
      // Check if already persisted
      const current = locationState.savedSearchState
      if (current?.ai?.answer === answer && current?.query === answeredQuery) {
        prevStatusRef.current = status
        return
      }

      // Persist complete state
      const newState: SavedSearchState = {
        query: answeredQuery,
        results,
        focusedChunkId,
        isAiMode,
        ai: { answer, citations, llmMaxTokens },
      }

      navigate(location.pathname + location.search, {
        replace: true,
        state: { savedSearchState: newState },
      })
    }

    prevStatusRef.current = status
  }, [
    status,
    answer,
    answeredQuery,
    results,
    citations,
    llmMaxTokens,
    focusedChunkId,
    locationState.savedSearchState,
    navigate,
    location.pathname,
    location.search,
  ])

  const handleSearch = (searchQuery: string) => {
    submitQuery(searchQuery)
    setSearchParams(searchQuery.trim() ? { q: searchQuery } : {})
  }

  // Show LLM answer panel
  const showLLMAnswer = isAiMode && (isGenerating || !!answer || !!llmError)

  // Build state to pass when navigating to document viewer
  const currentSavedState: SavedSearchState | undefined =
    hasSearched && results.length > 0
      ? {
          query: answeredQuery || urlQuery,
          results,
          focusedChunkId,
          isAiMode,
          ai:
            !isGenerating && answer && answeredQuery
              ? { answer, citations, llmMaxTokens }
              : undefined,
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
          hybridWeights={hybridWeights}
          onWeightsChange={setHybridWeights}
          maxResults={maxResults}
          onMaxResultsChange={setMaxResults}
          minScore={minScore}
          onMinScoreChange={setMinScore}
          notFocused={!!focusedChunkId}
          isAiMode={isAiMode}
          onAiModeToggle={toggleAi}
          llmMaxTokens={llmMaxTokens}
          onLlmMaxTokensChange={setLlmMaxTokens}
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
            citations={isAiMode ? citations : undefined}
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
