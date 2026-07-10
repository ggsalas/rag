import {
  useParams,
  useSearchParams,
  useLocation,
  useNavigate,
  useLoaderData,
  type LoaderFunctionArgs,
  type ShouldRevalidateFunction,
} from 'react-router'
import { useEffect } from 'react'
import { useAppStore } from '@/store/app.store'
import * as libraryService from '@/services/library.service'
import type { SearchPreferences } from '@/types/library'
import { useSearchSession, type SavedAi } from '@/hooks/useSearchSession'
import { useOramaHydration } from '@/hooks/useOramaHydration'
import { SearchBar } from '@/components/search/SearchBar'
import { ResultList } from '@/components/search/ResultList'
import { LLMAnswer } from '@/components/search/LLMAnswer'
import { ModelDownloadModal } from '@/components/search/ModelDownloadModal'
import { MainPanel } from '@/components/sidebar/MainPanel'

interface LocationState {
  searchQuery?: string
  focusedChunkId?: string | null
  savedAi?: SavedAi
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
  const modelStatus = useAppStore((s) => s.modelStatus)
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()

  useOramaHydration(libraryId)

  const locationState = (location.state ?? {}) as LocationState
  const initialQuery = searchParams.get('q') || locationState.searchQuery || ''
  // Restore AI answer from route state only if it belongs to the query we're loading.
  const savedAi =
    locationState.savedAi?.query === initialQuery ? locationState.savedAi : undefined

  const session = useSearchSession(libraryId!, {
    embeddingReady: modelStatus === 'ready',
    initialQuery,
    savedAi,
    initialFocusedChunkId: locationState.focusedChunkId ?? null,
    initialPrefs: searchPreferences,
  })

  const {
    phase,
    results,
    isSearching,
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
    isGenerating,
    llmError,
    focusedChunkId,
    setFocusedChunkId,
    showModelModal,
    submitQuery,
    toggleAi,
    acceptModelDownload,
    cancelModelDownload,
  } = session

  // Persist a completed answer to route state so it survives navigating to a
  // document and back. Guarded so restoring an answer doesn't re-navigate.
  useEffect(() => {
    if (phase !== 'answered' || !answer || !answeredQuery) return
    if (
      locationState.savedAi?.query === answeredQuery &&
      locationState.savedAi?.answer === answer
    )
      return
    navigate(location.pathname + location.search, {
      replace: true,
      state: {
        ...locationState,
        savedAi: { answer, citations, query: answeredQuery, llmMaxTokens },
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  const handleSearch = (searchQuery: string) => {
    submitQuery(searchQuery)
    setSearchParams(searchQuery.trim() ? { q: searchQuery } : {})
  }

  // Model download progress/errors now live in a toast (not below the search
  // bar), so this panel only shows the generated answer and generation errors.
  const showLLMAnswer = isAiMode && (isGenerating || !!answer || !!llmError)

  // Forwarded to ResultCard and LLMAnswer so they can include it in navigation state,
  // allowing the document viewer to pass it back when the user returns to search.
  const aiState: SavedAi | undefined =
    !isGenerating && answer && answeredQuery
      ? { answer, citations, query: answeredQuery, llmMaxTokens }
      : undefined

  return (
    <MainPanel>
      <div className="flex-1 overflow-y-auto p-6">
        <SearchBar
          onSearch={handleSearch}
          isSearching={isSearching}
          modelStatus={modelStatus}
          initialQuery={initialQuery}
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
            savedAi={aiState}
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
