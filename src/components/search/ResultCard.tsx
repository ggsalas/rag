import { useLayoutEffect, useRef } from 'react'
import type { SearchResult } from '@/types/search'
import type { SavedAi } from './ResultList'
import { ScoreBadge } from './ScoreBadge'
import { useParams, useSearchParams, useLocation, useNavigate } from 'react-router'

interface ResultCardProps {
  result: SearchResult
  rank: number
  isFocused?: boolean
  savedAi?: SavedAi
  sentToLLM?: boolean
}

export function ResultCard({
  result,
  rank,
  isFocused = false,
  savedAi,
  sentToLLM,
}: ResultCardProps) {
  const { libraryId } = useParams<{ libraryId: string }>()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const currentQuery = searchParams.get('q') || ''
  const cardRef = useRef<HTMLDivElement>(null)

  // useLayoutEffect fires before the browser paints — scroll position is set on the first
  // visible frame, with no animation to be interrupted by subsequent renders.
  useLayoutEffect(() => {
    if (isFocused && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'instant', block: 'center' })
    }
  }, [isFocused])

  const handleClick = () => {
    // Pre-flight replace: add focusedChunkId to the current search history entry so the
    // browser back button restores the same state as the "Back to search" button.
    navigate(location.pathname + location.search, {
      replace: true,
      state: { ...location.state, focusedChunkId: result.chunkId },
    })
    navigate(
      `/libraries/${libraryId}/documents/${result.documentId}?chunk=${result.chunkIndex}`,
      { state: { searchQuery: currentQuery, savedAi } },
    )
  }

  return (
    <div
      id={`result-${result.chunkId}`}
      ref={cardRef}
      role="link"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick() }}
      className={`block bg-white rounded-lg border p-4 hover:shadow-md transition-all cursor-pointer ${
        isFocused
          ? 'border-blue-400 ring-2 ring-blue-200'
          : 'border-gray-200 hover:border-blue-300'
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex-shrink-0 text-sm font-medium text-gray-400">
            #{rank}
          </span>
          <h3 className="text-sm font-semibold text-gray-900 truncate">
            {result.documentName}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {sentToLLM === false && (
            <span className="text-xs text-gray-400 shrink-0">
              outside AI context (limit: 10)
            </span>
          )}
          <ScoreBadge score={result.score} />
        </div>
      </div>

      {result.page && (
        <p className="text-xs text-gray-500 mb-2">
          Page {result.page} · Chunk {result.chunkIndex + 1}
        </p>
      )}
      {!result.page && (
        <p className="text-xs text-gray-500 mb-2">
          Chunk {result.chunkIndex + 1}
        </p>
      )}

      <p className="text-sm text-gray-700 leading-relaxed line-clamp-4">
        {result.text}
      </p>
    </div>
  )
}
