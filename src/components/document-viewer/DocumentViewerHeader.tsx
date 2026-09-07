import { Link } from 'react-router'
import type { DocumentMeta } from '@/types/document'
import type { SavedSearchState } from '@/types/search'
import { DeleteButton } from '@/components/ui/DeleteButton'
import { buttonClasses } from '@/components/ui/Button'

interface DocumentViewerHeaderProps {
  document: DocumentMeta
  backToSearchUrl: string
  backToSearchState?: { savedSearchState?: SavedSearchState }
  highlightChunkIndex: number | null
  onNavigateChunk: (index: number) => void
  onDelete: () => void
  showChunkInspector?: boolean
  onToggleChunkInspector?: () => void
}

const STATUS_COLORS: Record<DocumentMeta['status'], string> = {
  pending: 'bg-muted text-muted-foreground',
  parsing: 'bg-muted text-foreground',
  chunking: 'bg-muted text-foreground',
  embedding: 'bg-muted text-foreground',
  indexed: 'bg-muted text-foreground',
  error: 'bg-foreground text-background',
}

export function DocumentViewerHeader({
  document,
  backToSearchUrl,
  backToSearchState,
  highlightChunkIndex,
  onNavigateChunk,
  onDelete,
  showChunkInspector = false,
  onToggleChunkInspector,
}: DocumentViewerHeaderProps) {
  return (
    <div className="bg-background border-b border-border">
      <div className="max-w-5xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between mb-3">
          <Link
            to={backToSearchUrl}
            state={backToSearchState}
            className={buttonClasses({
              variant: 'ghost',
              size: 'xs',
              className: '-ml-3',
            })}
          >
            ← Back to search
          </Link>

          <div className="flex items-center gap-3">
            <span
              className={`px-2 py-1 text-xs font-medium rounded ${STATUS_COLORS[document.status]}`}
            >
              {document.status}
            </span>
            <DeleteButton onDelete={onDelete} variant="ghost" />
          </div>
        </div>

        <h1 className="text-2xl font-bold text-foreground mb-2">
          {document.name}
        </h1>

        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span>Type: {document.type.toUpperCase()}</span>
          <span>•</span>
          <span>Size: {(document.size / 1024).toFixed(2)} KB</span>
          <span>•</span>
          <span>Chunks: {document.chunkCount}</span>
          <div className="flex items-center gap-1 ml-1">
            <button
              onClick={() => onNavigateChunk(highlightChunkIndex! - 1)}
              disabled={
                highlightChunkIndex === null || highlightChunkIndex <= 0
              }
              className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
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
              className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Next chunk"
            >
              ↓
            </button>
          </div>
          {onToggleChunkInspector && (
            <button
              onClick={onToggleChunkInspector}
              disabled={document.chunkCount === 0}
              className={`px-2 py-1 text-xs font-medium rounded border transition-colors ${
                showChunkInspector
                  ? 'bg-foreground text-background border-foreground'
                  : 'bg-transparent border-border text-foreground hover:bg-accent'
              } disabled:opacity-30 disabled:cursor-not-allowed`}
              title={
                document.chunkCount > 0
                  ? 'Toggle chunk raw text inspector'
                  : 'No chunks to inspect'
              }
            >
              Chunk txt/md
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
