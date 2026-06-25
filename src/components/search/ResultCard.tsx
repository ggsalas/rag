import { useEffect, useRef } from 'react'
import type { SearchResult } from '@/types/search'
import { ScoreBadge } from './ScoreBadge'
import { Link, useParams, useSearchParams } from 'react-router'

interface ResultCardProps {
  result: SearchResult
  rank: number
  isFocused?: boolean
}

export function ResultCard({ result, rank, isFocused = false }: ResultCardProps) {
  const { libraryId } = useParams<{ libraryId: string }>()
  const [searchParams] = useSearchParams()
  const currentQuery = searchParams.get('q') || ''
  const cardRef = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    if (isFocused && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [isFocused])

  return (
    <Link
      ref={cardRef}
      to={`/libraries/${libraryId}/documents/${result.documentId}?chunk=${result.chunkIndex}`}
      state={{ searchQuery: currentQuery }}
      className={`block bg-white rounded-lg border p-4 hover:shadow-md transition-all ${
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
        <ScoreBadge score={result.score} />
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
    </Link>
  )
}
