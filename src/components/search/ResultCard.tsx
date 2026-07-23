import { useLayoutEffect, useRef } from 'react'
import type { SearchResult } from '@/types/search'
import type { SavedSearchState } from '@/types/search'
import { ScoreBadge } from './ScoreBadge'
import { useParams, useLocation, useNavigate } from 'react-router'

interface ResultCardProps {
  result: SearchResult
  isFocused?: boolean
  savedSearchState?: SavedSearchState
  /** undefined = AI mode off · null = AI mode on, not sent · number = sent with this citation index */
  llmCitationIndex?: number | null
}

export function ResultCard({
  result,
  isFocused = false,
  savedSearchState,
  llmCitationIndex,
}: ResultCardProps) {
  const { libraryId } = useParams<{ libraryId: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const cardRef = useRef<HTMLDivElement>(null)

  // useLayoutEffect fires before the browser paints — scroll position is set on the first
  // visible frame, with no animation to be interrupted by subsequent renders.
  useLayoutEffect(() => {
    if (isFocused && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'instant', block: 'center' })
    }
  }, [isFocused])

  const handleClick = () => {
    // Update savedSearchState with the focused chunk before navigating
    const stateWithFocus: SavedSearchState | undefined = savedSearchState
      ? { ...savedSearchState, focusedChunkId: result.chunkId }
      : undefined

    // Pre-flight replace: add focusedChunkId to the current search history entry so the
    // browser back button restores the same state as the "Back to search" button.
    navigate(location.pathname + location.search, {
      replace: true,
      state: { savedSearchState: stateWithFocus },
    })
    navigate(
      `/libraries/${libraryId}/documents/${result.documentId}?chunk=${result.chunkIndex}`,
      { state: { savedSearchState: stateWithFocus } },
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
      className={`block bg-background rounded-lg border p-4 transition-colors cursor-pointer ${
        isFocused ? 'border-foreground' : 'border-border hover:border-input'
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-sm font-semibold text-foreground truncate">
            {result.documentName}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {llmCitationIndex === null && (
            <span className="text-xs text-muted-foreground shrink-0">
              outside AI context (limit: 10)
            </span>
          )}
          {typeof llmCitationIndex === 'number' && (
            <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-semibold text-foreground shrink-0">
              {llmCitationIndex}
            </span>
          )}
          <ScoreBadge score={result.score} />
        </div>
      </div>

      <p className="text-xs text-muted-foreground mb-2">
        Chunk {result.chunkIndex + 1}
      </p>

      <p className="text-sm text-foreground leading-relaxed line-clamp-4">
        {result.text}
      </p>
    </div>
  )
}
