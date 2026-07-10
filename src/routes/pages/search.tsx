import {
  useParams,
  useSearchParams,
  useLocation,
  useNavigate,
} from 'react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store/app.store'
import { useSearch } from '@/hooks/useSearch'
import { useOramaHydration } from '@/hooks/useOramaHydration'
import { useLLMAnswer } from '@/hooks/useLLMAnswer'
import { SearchBar } from '@/components/search/SearchBar'
import { ResultList } from '@/components/search/ResultList'
import { LLMAnswer } from '@/components/search/LLMAnswer'
import { ModelDownloadModal } from '@/components/search/ModelDownloadModal'
import { ModelDownloadToast } from '@/components/search/ModelDownloadToast'
import { MainPanel } from '@/components/sidebar/MainPanel'
import type { LLMCitation } from '@/services/llm/llm.service'
import { LLM_CONTEXT_CHUNKS } from '@/lib/constants'
import type { SearchResult } from '@/types/search'

/** Stable id so the loading toast and its success/error transition target the same toast. */
const LLM_DOWNLOAD_TOAST_ID = 'llm-model-download'

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

  const [showModelModal, setShowModelModal] = useState(false)
  // Non-null while a download toast is active — gates the finalize effect below.
  const downloadToastActiveRef = useRef(false)

  // Shows the live download-progress toast (idempotent via the fixed id). Its
  // content subscribes to the store, so it updates itself as the model downloads.
  const showDownloadToast = useCallback(() => {
    if (downloadToastActiveRef.current) return
    downloadToastActiveRef.current = true
    toast(<ModelDownloadToast />, {
      id: LLM_DOWNLOAD_TOAST_ID,
      duration: Infinity,
    })
  }, [])

  // Finalize the download toast once the model finishes loading or fails.
  useEffect(() => {
    if (!downloadToastActiveRef.current) return
    if (llmStatus === 'ready') {
      // Keep the SAME toast (it now shows 100% / "AI model ready") and just
      // dismiss it after a moment — swapping in a separate success toast reads
      // as confusing.
      downloadToastActiveRef.current = false
      setTimeout(() => toast.dismiss(LLM_DOWNLOAD_TOAST_ID), 2000)
    } else if (llmStatus === 'error') {
      toast.error(loadError ?? 'Failed to download the AI model', {
        id: LLM_DOWNLOAD_TOAST_ID,
        duration: 6000,
      })
      downloadToastActiveRef.current = false
    }
  }, [llmStatus, loadError])

  // AI toggle: enabling for the first time needs a model download, so we confirm
  // via a modal first. Turning it off (or when already downloaded) is immediate.
  const handleAiToggle = useCallback(() => {
    if (isAiMode || llmStatus === 'ready') {
      toggleAiMode()
      return
    }
    setShowModelModal(true)
  }, [isAiMode, llmStatus, toggleAiMode])

  const handleAcceptDownload = useCallback(() => {
    setShowModelModal(false)
    showDownloadToast()
    toggleAiMode()
  }, [showDownloadToast, toggleAiMode])

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
      showDownloadToast()
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
          onWeightsChange={(w) => { setFocusedChunkId(null); setHybridWeights(w) }}
          maxResults={maxResults}
          onMaxResultsChange={(n) => { setFocusedChunkId(null); setMaxResults(n) }}
          minScore={minScore}
          onMinScoreChange={(n) => { setFocusedChunkId(null); setMinScore(n) }}
          notFocused={!!focusedChunkId}
          isAiMode={isAiMode}
          onAiModeToggle={handleAiToggle}
          llmMaxTokens={llmMaxTokens}
          onLlmMaxTokensChange={(n) => { setFocusedChunkId(null); setLlmMaxTokens(n) }}
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
        onAccept={handleAcceptDownload}
        onCancel={() => setShowModelModal(false)}
      />
    </MainPanel>
  )
}
