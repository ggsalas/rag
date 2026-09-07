import { useEffect, useState, useRef } from 'react'
import {
  useParams,
  useSearchParams,
  useLocation,
  useNavigate,
} from 'react-router'
import {
  getDocumentContent,
  getDocumentById,
} from '@/services/document.service'
import { useChunkData } from '@/hooks/data/useChunkData'
import { useDocuments } from '@/hooks/useDocuments'
import { MainPanel } from '@/components/sidebar/MainPanel'
import { DocumentViewerHeader } from '@/components/document-viewer/DocumentViewerHeader'
import { HighlightedText } from '@/components/document-viewer/HighlightedText'
import type { DocumentContent, DocumentMeta } from '@/types/document'
import type { SavedSearchState } from '@/types/search'

export function DocumentViewerPage() {
  const { libraryId, documentId } = useParams<{
    libraryId: string
    documentId: string
  }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [content, setContent] = useState<DocumentContent | null>(null)
  const [document, setDocument] = useState<DocumentMeta | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showChunkInspector, setShowChunkInspector] = useState(false)
  const highlightRef = useRef<HTMLElement>(null)

  const { deleteDocument } = useDocuments(libraryId!)
  const locationState = location.state as {
    savedSearchState?: SavedSearchState
  } | null
  const savedSearchState = locationState?.savedSearchState

  const highlightChunkIndex = searchParams.get('chunk')
    ? parseInt(searchParams.get('chunk')!, 10)
    : null

  const { chunk } = useChunkData(libraryId, documentId, highlightChunkIndex)
  const chunkText = chunk?.text ?? null

  useEffect(() => {
    async function loadDocument() {
      if (!documentId) return
      setIsLoading(true)
      setError(null)
      try {
        const [docContent, docMeta] = await Promise.all([
          getDocumentContent(documentId),
          getDocumentById(documentId),
        ])
        if (!docMeta) {
          setError('Document metadata not found')
          return
        }
        setDocument(docMeta)
        setContent(docContent || null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load document')
      } finally {
        setIsLoading(false)
      }
    }
    loadDocument()
  }, [documentId])

  const navigateToChunk = (index: number) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('chunk', String(index))
        return next
      },
      { replace: true, state: location.state },
    )
  }

  const toggleChunkInspector = () => {
    if (highlightChunkIndex === null) {
      // No chunk selected yet: jump to the first chunk and open the inspector
      navigateToChunk(0)
      setShowChunkInspector(true)
    } else {
      setShowChunkInspector((prev) => !prev)
    }
  }

  const handleDelete = async () => {
    await deleteDocument(documentId!)
    const searchQuery = savedSearchState?.query
    const backUrl = searchQuery
      ? `/libraries/${libraryId}/search?q=${encodeURIComponent(searchQuery)}`
      : `/libraries/${libraryId}/search`
    navigate(backUrl, { state: { savedSearchState } })
  }

  if (isLoading) {
    return (
      <MainPanel>
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground">Loading document...</div>
        </div>
      </MainPanel>
    )
  }

  if (error) {
    return (
      <MainPanel>
        <div className="p-4">
          <div className="bg-muted border border-border rounded-lg p-4">
            <p className="text-foreground">{error}</p>
          </div>
        </div>
      </MainPanel>
    )
  }

  if (!document) return null

  const searchQuery = savedSearchState?.query
  const backToSearchUrl = searchQuery
    ? `/libraries/${libraryId}/search?q=${encodeURIComponent(searchQuery)}`
    : `/libraries/${libraryId}/search`

  // Update focusedChunkId in the state when navigating back
  const backState: { savedSearchState?: SavedSearchState } | undefined =
    savedSearchState
      ? {
          savedSearchState: {
            ...savedSearchState,
            focusedChunkId: chunk?.id ?? null,
          },
        }
      : undefined

  return (
    <MainPanel>
      <div className="flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 bg-background">
          <DocumentViewerHeader
            document={document}
            backToSearchUrl={backToSearchUrl}
            backToSearchState={backState}
            highlightChunkIndex={highlightChunkIndex}
            onNavigateChunk={navigateToChunk}
            onDelete={handleDelete}
            showChunkInspector={showChunkInspector}
            onToggleChunkInspector={toggleChunkInspector}
          />

          {document.status === 'error' && document.error && (
            <div className="border-b border-border bg-muted/30">
              <div className="max-w-5xl mx-auto px-6 py-3">
                <p className="text-sm font-semibold text-destructive">
                  Document processing failed
                </p>
                <p className="mt-1 text-sm text-muted-foreground font-mono bg-muted border border-border rounded p-2 break-words">
                  {document.error}
                </p>
              </div>
            </div>
          )}

          {showChunkInspector && highlightChunkIndex !== null && (
            <div className="border-b border-border bg-muted/30">
              <div className="max-w-5xl mx-auto px-6 py-4">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Chunk {highlightChunkIndex} — Chunk text
                  </span>
                  {chunk && chunk.sectionPath.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      ({chunk.sectionPath.join(' › ')})
                    </span>
                  )}
                </div>
                {chunk ? (
                  <pre className="font-mono text-xs bg-background border border-border rounded p-3 overflow-x-auto whitespace-pre-wrap break-words max-h-96 overflow-y-auto">
                    {chunk.searchText}
                  </pre>
                ) : (
                  <div className="text-sm text-muted-foreground italic">
                    No chunk data available
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="max-w-5xl mx-auto px-6 py-6">
          <div className="font-mono text-sm">
            {content ? (
              <div className="prose max-w-none">
                <HighlightedText
                  text={content.text}
                  highlight={chunkText}
                  highlightRef={highlightRef}
                />
              </div>
            ) : (
              <div className="text-center text-muted-foreground">
                {document.status === 'error'
                  ? // The stored error message (if any) is shown in the banner
                    // above; the generic fallback only applies when none exists.
                    !document.error && (
                      <p className="font-semibold text-destructive">
                        Document processing failed
                      </p>
                    )
                  : 'Document is being processed...'}
              </div>
            )}
          </div>
        </div>
      </div>
    </MainPanel>
  )
}
