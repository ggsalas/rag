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
import { useDocumentActions } from '@/hooks/useDocumentActions'
import { MainPanel } from '@/components/sidebar/MainPanel'
import { DocumentViewerHeader } from '@/components/document-viewer/DocumentViewerHeader'
import { HighlightedText } from '@/components/document-viewer/HighlightedText'
import type { DocumentContent, DocumentMeta } from '@/types/document'

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
  const highlightRef = useRef<HTMLElement>(null)

  const { deleteDocument } = useDocumentActions()
  const locationState = location.state as {
    searchQuery?: string
    savedAi?: unknown
  } | null
  const searchQuery = locationState?.searchQuery
  const savedAi = locationState?.savedAi

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

  const handleDelete = async () => {
    await deleteDocument(documentId!)
    const backUrl = searchQuery
      ? `/libraries/${libraryId}/search?q=${encodeURIComponent(searchQuery)}`
      : `/libraries/${libraryId}/search`
    navigate(backUrl, { state: { searchQuery, savedAi } })
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
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800">{error}</p>
          </div>
        </div>
      </MainPanel>
    )
  }

  if (!document) return null

  const backToSearchUrl = searchQuery
    ? `/libraries/${libraryId}/search?q=${encodeURIComponent(searchQuery)}`
    : `/libraries/${libraryId}/search`

  return (
    <MainPanel>
      <div className="flex-1 overflow-y-auto">
        <DocumentViewerHeader
          document={document}
          backToSearchUrl={backToSearchUrl}
          backToSearchState={{
            searchQuery,
            focusedChunkId: chunk?.id ?? null,
            savedAi,
          }}
          highlightChunkIndex={highlightChunkIndex}
          onNavigateChunk={navigateToChunk}
          onDelete={handleDelete}
        />

        <div className="max-w-5xl mx-auto px-6 py-6">
          <div className="font-mono">
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
                  ? 'Document processing failed'
                  : 'Document is being processed...'}
              </div>
            )}
          </div>
        </div>
      </div>
    </MainPanel>
  )
}
