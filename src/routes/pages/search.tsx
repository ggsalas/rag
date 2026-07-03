import { useParams, useSearchParams, useLocation, useNavigate } from 'react-router'
import { useEffect } from 'react'
import { useAppStore } from '@/store/app.store'
import { useSearch } from '@/hooks/useSearch'
import { useOramaHydration } from '@/hooks/useOramaHydration'
import { useLLMAnswer } from '@/hooks/useLLMAnswer'
import { SearchBar } from '@/components/search/SearchBar'
import { ResultList } from '@/components/search/ResultList'
import { LLMAnswer } from '@/components/search/LLMAnswer'
import { MainPanel } from '@/components/sidebar/MainPanel'
import type { LLMCitation } from '@/services/llm/llm.service'

interface SavedAi {
  answer: string
  citations: LLMCitation[]
  query: string
}

interface LocationState {
  searchQuery?: string
  focusedChunkId?: string | null
  savedAi?: SavedAi
}

export function SearchPage() {
  const { libraryId } = useParams<{ libraryId: string }>()
  const modelStatus = useAppStore((s) => s.modelStatus)
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()

  useOramaHydration(libraryId)

  const locationState = (location.state ?? {}) as LocationState
  const stateQuery = locationState.searchQuery
  const initialQuery = searchParams.get('q') || stateQuery || ''
  const focusedChunkId = locationState.focusedChunkId

  const {
    query,
    results,
    isSearching,
    error,
    hasSearched,
    search: performSearch,
    hybridWeights,
    setHybridWeights,
    maxResults,
    setMaxResults,
    minScore,
    setMinScore,
  } = useSearch(libraryId!, modelStatus === 'ready' ? initialQuery : '')

  // Restore AI answer from route state if the query matches
  const savedAi = locationState.savedAi?.query === initialQuery ? locationState.savedAi : undefined

  const {
    isAiMode,
    toggleAiMode,
    answer,
    citations,
    answeredQuery,
    isGenerating,
    llmStatus,
    llmProgress,
    llmError,
    generate,
    clear: clearAnswer,
    loadModel: loadLLM,
  } = useLLMAnswer(savedAi ? { answer: savedAi.answer, citations: savedAi.citations, answeredQuery: savedAi.query } : {})

  // Persist completed answer to route state so it survives navigation to documents and back
  useEffect(() => {
    if (isGenerating || !answer || !answeredQuery) return
    // Skip if already saved (avoids redundant navigate on mount with restored state)
    if (locationState.savedAi?.query === answeredQuery && locationState.savedAi?.answer === answer) return
    navigate(location.pathname + location.search, {
      replace: true,
      state: { ...locationState, savedAi: { answer, citations, query: answeredQuery } },
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGenerating])

  // Trigger generation after search completes when AI mode is active
  useEffect(() => {
    if (!isAiMode) { clearAnswer(); return }
    if (llmStatus === 'idle') { loadLLM(); return }
    if (llmStatus !== 'ready') return
    if (!hasSearched) {
      // Clear only when the user explicitly wiped the query (X button)
      if (!query.trim()) clearAnswer()
      return
    }
    // Skip if we already have the answer for this exact query (e.g. restored from nav state)
    if (answer && answeredQuery === query) return
    if (results.length > 0) generate(query, results)
    else clearAnswer()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, isAiMode, llmStatus, hasSearched, query])

  const handleSearch = (searchQuery: string) => {
    performSearch(searchQuery)
    if (searchQuery.trim()) {
      setSearchParams({ q: searchQuery })
    } else {
      setSearchParams({})
    }
  }

  const showLLMAnswer =
    isAiMode &&
    (llmStatus === 'loading' ||
      llmStatus === 'error' ||
      isGenerating ||
      !!answer ||
      !!llmError)

  // Forwarded to ResultCard and LLMAnswer so they can include it in navigation state,
  // allowing the document viewer to pass it back when the user returns to search.
  const aiState: SavedAi | undefined =
    !isGenerating && answer && answeredQuery
      ? { answer, citations, query: answeredQuery }
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
          onAiModeToggle={toggleAiMode}
        />

        {showLLMAnswer && (
          <div className="mt-6">
            <LLMAnswer
              answer={answer}
              citations={citations}
              isGenerating={isGenerating}
              llmStatus={llmStatus}
              llmProgress={llmProgress}
              error={llmError}
              savedAi={aiState}
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
          />
        </div>
      </div>
    </MainPanel>
  )
}
