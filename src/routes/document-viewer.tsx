import { useEffect, useState, useRef } from 'react'
import {
  useParams,
  useSearchParams,
  useLocation,
  useNavigate,
  Link,
} from 'react-router'
import {
  getDocumentContent,
  getDocumentById,
} from '@/services/document.service'
import { useChunkData } from '@/hooks/data/useChunkData'
import { useDocumentActions } from '@/hooks/useDocumentActions'
import { MainPanel } from '@/components/sidebar/MainPanel'
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
  const [confirmDelete, setConfirmDelete] = useState(false)
  const highlightRef = useRef<HTMLElement>(null)

  const { deleteDocument } = useDocumentActions()

  // Get search query from location state (passed from ResultCard)
  const searchQuery = (location.state as { searchQuery?: string })?.searchQuery

  const highlightChunkIndex = searchParams.get('chunk')
    ? parseInt(searchParams.get('chunk')!, 10)
    : null

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

  // Load chunk text for highlighting using data hook
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

        // Always set document metadata (even if content not available yet)
        setDocument(docMeta)

        // Set content (null if not available for documents in queue or with errors)
        setContent(docContent || null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load document')
      } finally {
        setIsLoading(false)
      }
    }

    loadDocument()
  }, [documentId])

  // Scroll to highlighted chunk after render
  useEffect(() => {
    if (!isLoading && highlightRef.current) {
      scrollToCenter(highlightRef.current, 200)
    }
  }, [isLoading, chunkText])

  // Handle delete confirmation timeout
  useEffect(() => {
    if (confirmDelete) {
      const timer = setTimeout(() => setConfirmDelete(false), 3000)
      return () => clearTimeout(timer)
    }
  }, [confirmDelete])

  // Handle delete action
  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }

    await deleteDocument(documentId!)

    // Navigate back to search after deletion
    const backToSearchUrl = searchQuery
      ? `/libraries/${libraryId}/search?q=${encodeURIComponent(searchQuery)}`
      : `/libraries/${libraryId}/search`

    navigate(backToSearchUrl, { state: { searchQuery } })
  }

  if (isLoading) {
    return (
      <MainPanel>
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">Loading document...</div>
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

  // Document not found
  if (!document) {
    return null
  }

  // Build back link URL
  const backToSearchUrl = searchQuery
    ? `/libraries/${libraryId}/search?q=${encodeURIComponent(searchQuery)}`
    : `/libraries/${libraryId}/search`

  const backToSearchState = {
    searchQuery,
    focusedChunkId: chunk?.id ?? null,
  }

  // Status badge color based on document status
  const statusColor = {
    pending: 'bg-yellow-100 text-yellow-800',
    parsing: 'bg-blue-100 text-blue-800',
    chunking: 'bg-blue-100 text-blue-800',
    embedding: 'bg-blue-100 text-blue-800',
    indexed: 'bg-green-100 text-green-800',
    error: 'bg-red-100 text-red-800',
  }[document.status]

  return (
    <MainPanel>
      <div className="flex-1 overflow-y-auto">
        {/* Sticky header with back button and document title */}
        <div className="sticky top-0 z-10 bg-white shadow-sm transition-shadow">
          <div className="max-w-5xl mx-auto px-6 py-4">
            {/* Top row: Back link and actions */}
            <div className="flex items-center justify-between mb-3">
              <Link
                to={backToSearchUrl}
                state={backToSearchState}
                className="inline-flex items-center text-sm text-blue-600 hover:text-blue-800"
              >
                ← Back to search
              </Link>

              <div className="flex items-center gap-3">
                {/* Status indicator */}
                <span
                  className={`px-2 py-1 text-xs font-medium rounded ${statusColor}`}
                >
                  {document.status}
                </span>

                {/* Delete button */}
                <button
                  onClick={handleDelete}
                  className={`w-auto  h-6 px-2 rounded flex items-center justify-center text-sm transition-colors ${
                    confirmDelete
                      ? 'bg-red-100 text-red-700 hover:bg-red-200'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                  title={
                    confirmDelete ? 'Click again to confirm' : 'Delete document'
                  }
                >
                  {confirmDelete ? '✓ Confirm delete' : '×'}
                </button>
              </div>
            </div>

            {/* Document title */}
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              {document.name}
            </h1>

            {/* Document metadata */}
            <div className="flex items-center gap-4 text-sm text-gray-500">
              <span>Type: {document.type.toUpperCase()}</span>
              <span>•</span>
              <span>Size: {(document.size / 1024).toFixed(2)} KB</span>
              <span>•</span>
              <span>Chunks: {document.chunkCount}</span>
              <div className="flex items-center gap-1 ml-1">
                <button
                  onClick={() =>
                    navigateToChunk(highlightChunkIndex! - 1)
                  }
                  disabled={
                    highlightChunkIndex === null || highlightChunkIndex <= 0
                  }
                  className="w-6 h-6 flex items-center justify-center rounded text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title="Previous chunk"
                >
                  ↑
                </button>
                <button
                  onClick={() =>
                    navigateToChunk(
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

        {/* Document content or processing state */}
        <div className="max-w-5xl mx-auto px-6 py-6">
          {content ? (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="prose max-w-none">
                <HighlightedText
                  text={content.text}
                  highlight={chunkText}
                  highlightRef={highlightRef}
                />
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="text-center text-gray-500">
                {document.status === 'error'
                  ? 'Document processing failed'
                  : 'Document is being processed...'}
              </div>
            </div>
          )}
        </div>
      </div>
    </MainPanel>
  )
}

function scrollToCenter(element: HTMLElement, duration: number) {
  const container = element.closest('.overflow-y-auto') as HTMLElement | null
  if (!container) return

  const containerRect = container.getBoundingClientRect()
  const elementRect = element.getBoundingClientRect()
  const target =
    container.scrollTop +
    (elementRect.top - containerRect.top) -
    (containerRect.height - elementRect.height) / 2

  const start = container.scrollTop
  const distance = target - start
  const startTime = performance.now()

  const ease = (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t)

  const step = (now: number) => {
    const progress = Math.min((now - startTime) / duration, 1)
    container.scrollTop = start + distance * ease(progress)
    if (progress < 1) requestAnimationFrame(step)
  }

  requestAnimationFrame(step)
}

interface HighlightedTextProps {
  text: string
  highlight: string | null
  highlightRef: React.RefObject<HTMLElement | null>
}

function HighlightedText({
  text,
  highlight,
  highlightRef,
}: HighlightedTextProps) {
  if (!highlight) {
    return <div className="whitespace-pre-wrap text-gray-800">{text}</div>
  }

  const match = findChunkInText(text, highlight)

  if (!match) {
    return <div className="whitespace-pre-wrap text-gray-800">{text}</div>
  }

  const before = text.slice(0, match.start)
  const highlighted = text.slice(match.start, match.end)
  const after = text.slice(match.end)

  return (
    <div className="whitespace-pre-wrap text-gray-800">
      {before}
      <mark ref={highlightRef} className="bg-yellow-200 rounded px-0.5">
        {highlighted}
      </mark>
      {after}
    </div>
  )
}

/**
 * Build a mapping from a "spaceless" string back to original string indices.
 * Removes all whitespace chars, returns the stripped string and a map where
 * map[i] = the index in the original string of the i-th non-space character.
 */
function buildSpacelessMap(text: string): { stripped: string; map: number[] } {
  const map: number[] = []
  let stripped = ''
  for (let i = 0; i < text.length; i++) {
    if (!/\s/.test(text[i]!)) {
      stripped += text[i]
      map.push(i)
    }
  }
  return { stripped, map }
}

function findChunkInText(
  fullText: string,
  chunkText: string,
): { start: number; end: number } | null {
  // 1. Try exact match first (fast path, works for txt/md/docx)
  const exactIndex = fullText.indexOf(chunkText)
  if (exactIndex !== -1) {
    return { start: exactIndex, end: exactIndex + chunkText.length }
  }

  // 2. Remove ALL whitespace from both and match on characters only.
  //    This handles cases where chunking inserts/removes spaces (e.g. around punctuation).
  const { stripped: strippedFull, map: fullMap } = buildSpacelessMap(fullText)
  const { stripped: strippedChunk } = buildSpacelessMap(chunkText)

  // Try full stripped chunk
  let idx = strippedFull.indexOf(strippedChunk)
  if (idx !== -1) {
    const start = fullMap[idx]!
    const endIdx = idx + strippedChunk.length - 1
    const end = endIdx < fullMap.length ? fullMap[endIdx]! + 1 : fullText.length
    return { start, end }
  }

  // 3. If not found (overlap zone has text not in original), skip overlap
  const attempts = [150, 100, 60]
  for (const skip of attempts) {
    if (skip >= strippedChunk.length - 20) continue
    const core = strippedChunk.slice(skip)
    if (core.length < 20) continue

    idx = strippedFull.indexOf(core)
    if (idx !== -1) {
      const start = fullMap[Math.max(0, idx - skip)]!
      const endIdx = idx + core.length - 1
      const end =
        endIdx < fullMap.length ? fullMap[endIdx]! + 1 : fullText.length
      return { start, end }
    }
  }

  return null
}
