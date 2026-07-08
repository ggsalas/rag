import { useLayoutEffect, useRef } from 'react'
import type { SearchResult } from '@/types/search'
import type { SavedAi } from './ResultList'
import { ScoreBadge } from './ScoreBadge'
import {
  useParams,
  useSearchParams,
  useLocation,
  useNavigate,
} from 'react-router'

interface ResultCardProps {
  result: SearchResult
  isFocused?: boolean
  savedAi?: SavedAi
  /** undefined = AI mode off · null = AI mode on, not sent · number = sent with this citation index */
  llmCitationIndex?: number | null
}

export function ResultCard({
  result,
  isFocused = false,
  savedAi,
  llmCitationIndex,
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
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') handleClick()
      }}
      className={`block bg-white rounded-lg border p-4 hover:shadow-md transition-all cursor-pointer ${
        isFocused
          ? 'border-blue-400 ring-2 ring-blue-200'
          : 'border-gray-200 hover:border-blue-300'
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 truncate">
            {result.documentName}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {llmCitationIndex === null && (
            <span className="text-xs text-gray-400 shrink-0">
              outside AI context (limit: 10)
            </span>
          )}
          {typeof llmCitationIndex === 'number' && (
            <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-semibold text-blue-700 bg-blue-100 rounded shrink-0">
              {llmCitationIndex}
            </span>
          )}
          <ScoreBadge score={result.score} />
        </div>
      </div>

      <p className="text-xs text-gray-500 mb-2">
        Chunk {result.chunkIndex + 1}
      </p>

      <p className="text-sm text-gray-700 leading-relaxed line-clamp-4">
        {result.text}
      </p>
    </div>
  )
}
