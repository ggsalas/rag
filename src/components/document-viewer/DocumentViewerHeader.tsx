import { Link } from 'react-router'
import type { DocumentMeta } from '@/types/document'
import { DeleteButton } from '@/components/DeleteButton'

interface DocumentViewerHeaderProps {
  document: DocumentMeta
  backToSearchUrl: string
  backToSearchState: { searchQuery?: string; focusedChunkId: string | null; savedAi?: unknown }
  highlightChunkIndex: number | null
  onNavigateChunk: (index: number) => void
  onDelete: () => void
}

const STATUS_COLORS: Record<DocumentMeta['status'], string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  parsing: 'bg-blue-100 text-blue-800',
  chunking: 'bg-blue-100 text-blue-800',
  embedding: 'bg-blue-100 text-blue-800',
  indexed: 'bg-green-100 text-green-800',
  error: 'bg-red-100 text-red-800',
}

export function DocumentViewerHeader({
  document,
  backToSearchUrl,
  backToSearchState,
  highlightChunkIndex,
  onNavigateChunk,
  onDelete,
}: DocumentViewerHeaderProps) {
  return (
    <div className="sticky top-0 z-10 bg-white shadow-sm transition-shadow">
      <div className="max-w-5xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between mb-3">
          <Link
            to={backToSearchUrl}
            state={backToSearchState}
            className="inline-flex items-center text-sm text-blue-600 hover:text-blue-800"
          >
            ← Back to search
          </Link>

          <div className="flex items-center gap-3">
            <span
              className={`px-2 py-1 text-xs font-medium rounded ${STATUS_COLORS[document.status]}`}
            >
              {document.status}
            </span>
            <DeleteButton onDelete={onDelete} />
          </div>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-2">{document.name}</h1>

        <div className="flex items-center gap-4 text-sm text-gray-500">
          <span>Type: {document.type.toUpperCase()}</span>
          <span>•</span>
          <span>Size: {(document.size / 1024).toFixed(2)} KB</span>
          <span>•</span>
          <span>Chunks: {document.chunkCount}</span>
          <div className="flex items-center gap-1 ml-1">
            <button
              onClick={() => onNavigateChunk(highlightChunkIndex! - 1)}
              disabled={highlightChunkIndex === null || highlightChunkIndex <= 0}
              className="w-6 h-6 flex items-center justify-center rounded text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Previous chunk"
            >
              ↑
            </button>
            <button
              onClick={() =>
                onNavigateChunk(
                  highlightChunkIndex === null ? 0 : highlightChunkIndex + 1,
                )
              }
              disabled={
                highlightChunkIndex !== null &&
                highlightChunkIndex >= document.chunkCount - 1
              }
              className="w-6 h-6 flex items-center justify-center rounded text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Next chunk"
            >
              ↓
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
