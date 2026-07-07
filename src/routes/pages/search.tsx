import {
  useParams,
  useSearchParams,
  useLocation,
  useNavigate,
} from 'react-router'
import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store/app.store'
import { useSearch } from '@/hooks/useSearch'
import { useOramaHydration } from '@/hooks/useOramaHydration'
import { useLLMAnswer } from '@/hooks/useLLMAnswer'
import { SearchBar } from '@/components/search/SearchBar'
import { ResultList } from '@/components/search/ResultList'
import { LLMAnswer } from '@/components/search/LLMAnswer'
import { MainPanel } from '@/components/sidebar/MainPanel'
import type { LLMCitation } from '@/services/llm/llm.service'
import { LLM_CONTEXT_CHUNKS } from '@/lib/constants'
import type { SearchResult } from '@/types/search'

/** Returns a stable string key representing which doc+chunk pairs are in a context window */
function chunkContextKey(
  items: Array<Pick<SearchResult | LLMCitation, 'documentId' | 'chunkId'>>,
): string {
  return items.map((i) => `${i.documentId}:${i.chunkId}`).join(',')
}

interface SavedAi {
  answer: string
  citations: LLMCitation[]
  query: string
  llmMaxTokens: number
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
  const [focusedChunkId, setFocusedChunkId] = useState(
    locationState.focusedChunkId ?? null,
  )

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
    llmMaxTokens,
    setLlmMaxTokens,
  } = useSearch(libraryId!, modelStatus === 'ready' ? initialQuery : '')

  // Restore AI answer from route state if the query matches
  const savedAi =
    locationState.savedAi?.query === initialQuery
      ? locationState.savedAi
      : undefined

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
    loadError,
    generate,
    clear: clearAnswer,
    loadModel: loadLLM,
  } = useLLMAnswer(
    savedAi
      ? {
          answer: savedAi.answer,
          citations: savedAi.citations,
          answeredQuery: savedAi.query,
        }
      : {},
  )

  // Persist completed answer to route state so it survives navigation to documents and back
  useEffect(() => {
    if (isGenerating || !answer || !answeredQuery) return
    // Skip if already saved (avoids redundant navigate on mount with restored state)
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
  }, [isGenerating])

  // Tracks the signature (doc+chunk keys + maxTokens) last sent to the LLM. Initialized from
  // savedAi so navigating back with same context skips re-gen — uses the maxTokens the answer
  // was generated with, not the current state (which may not have loaded from prefs yet).
  const prevContextSigRef = useRef<string>(
    savedAi ? `${chunkContextKey(savedAi.citations)}|${savedAi.llmMaxTokens}` : '',
  )

  // Trigger generation after search completes when AI mode is active
  useEffect(() => {
    if (!isAiMode) {
      clearAnswer()
      return
    }
    if (llmStatus === 'idle') {
      loadLLM()
      return
    }
    if (llmStatus !== 'ready') return
    if (!hasSearched) {
      if (!query.trim()) clearAnswer()
      return
    }
    const contextSig = `${chunkContextKey(results.slice(0, LLM_CONTEXT_CHUNKS))}|${llmMaxTokens}`
    // Skip only when query AND chunks AND maxTokens are identical (e.g. restored from nav state).
    // A config change produces different chunks or different maxTokens → regenerate.
    if (
      answer &&
      answeredQuery === query &&
      contextSig === prevContextSigRef.current
    )
      return
    prevContextSigRef.current = contextSig
    if (results.length > 0) generate(query, results, llmMaxTokens)
    else clearAnswer()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, isAiMode, llmStatus, hasSearched, query, llmMaxTokens])

  const handleSearch = (searchQuery: string) => {
    setFocusedChunkId(null)
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
          onWeightsChange={(w) => { setFocusedChunkId(null); setHybridWeights(w) }}
          maxResults={maxResults}
          onMaxResultsChange={(n) => { setFocusedChunkId(null); setMaxResults(n) }}
          minScore={minScore}
          onMinScoreChange={(n) => { setFocusedChunkId(null); setMinScore(n) }}
          notFocused={!!focusedChunkId}
          isAiMode={isAiMode}
          onAiModeToggle={toggleAiMode}
          llmMaxTokens={llmMaxTokens}
          onLlmMaxTokensChange={(n) => { setFocusedChunkId(null); setLlmMaxTokens(n) }}
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
              loadError={loadError}
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
    </MainPanel>
  )
}
