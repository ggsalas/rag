import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useDocuments } from '@/hooks/useDocuments'
import { DropZone } from '@/components/documents/DropZone'
import { useAppStore } from '@/store/app.store'
import { MainPanel } from '@/components/sidebar/MainPanel'
import { useIndexedDocumentCountData } from '@/hooks/data/useIndexedDocumentCountData'
import { useProcessingCountData } from '@/hooks/data/useProcessingCountData'
import { reindexLibrary } from '@/services/reindex.service'

export function DocumentsPage() {
  const { libraryId } = useParams<{ libraryId: string }>()
  const { uploadFiles } = useDocuments(libraryId!)
  const modelStatus = useAppStore((s) => s.modelStatus)
  const navigate = useNavigate()

  const { count } = useIndexedDocumentCountData(libraryId!)
  const processingCount = useProcessingCountData(libraryId)
  const hadProcessingRef = useRef(false)

  const [reindexing, setReindexing] = useState(false)
  const [reindexProgress, setReindexProgress] = useState<{
    current: number
    total: number
  } | null>(null)

  useEffect(() => {
    if (processingCount > 0) {
      hadProcessingRef.current = true
      return
    }
    if (hadProcessingRef.current && count > 0) {
      navigate(`/libraries/${libraryId}/search`, { replace: true })
    }
  }, [processingCount, count, libraryId, navigate])

  const handleReindex = async () => {
    if (!libraryId || reindexing) return
    setReindexing(true)
    setReindexProgress({ current: 0, total: 0 })
    try {
      const { reindexed } = await reindexLibrary(libraryId, (current, total) => {
        setReindexProgress({ current, total })
      })
      toast.success(
        reindexed === 0
          ? 'No chunks to reindex.'
          : `Reindexed ${reindexed} chunks with the current embedding model.`,
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Reindex failed'
      toast.error(msg)
    } finally {
      setReindexing(false)
      setReindexProgress(null)
    }
  }

  return (
    <MainPanel noAddDocment>
      <div className="flex flex-col h-full overflow-y-auto">
        <div className="p-6 min-h-[50vh]">
          <DropZone
            onFiles={(files) => uploadFiles(files)}
            disabled={modelStatus === 'loading'}
            className="w-full h-full min-h-[calc(50vh-3rem)]"
          />
        </div>

        <div className="border-t border-gray-100 px-8 py-8 space-y-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
            How documents are processed
          </h2>

          <div className="grid grid-cols-3 gap-6">
            <div>
              <p className="text-sm font-medium text-gray-700 mb-1">PDF</p>
              <p className="text-sm text-gray-500">
                Text is extracted page by page and split into sentence-based chunks. Each chunk keeps its page number for reference.
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700 mb-1">Markdown</p>
              <p className="text-sm text-gray-500">
                Split by headings — each section becomes its own chunk. Long sections are further divided by paragraph.
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700 mb-1">TXT / DOCX</p>
              <p className="text-sm text-gray-500">
                Split by paragraphs. Chunks overlap by 100 characters so context is not lost at boundaries.
              </p>
            </div>
          </div>

          <p className="text-sm text-gray-400">
            All chunks are embedded using <span className="font-mono">bge-small-en-v1.5</span> (384 dimensions, English, retrieval-tuned) and stored locally — nothing leaves your device.
          </p>

          {count > 0 && (
            <div className="border-t border-gray-100 pt-6 space-y-2">
              <h3 className="text-sm font-semibold text-gray-700">Rebuild embeddings</h3>
              <p className="text-sm text-gray-500">
                Regenerate embeddings for every chunk in this library using the current model. Useful after the embedding model has been upgraded — old embeddings live in a different vector space and search quality suffers until they're rebuilt.
              </p>
              <button
                type="button"
                onClick={handleReindex}
                disabled={reindexing || modelStatus !== 'ready'}
                className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:bg-gray-100 disabled:text-gray-400 rounded transition-colors"
              >
                {reindexing
                  ? reindexProgress && reindexProgress.total > 0
                    ? `Rebuilding… ${reindexProgress.current}/${reindexProgress.total}`
                    : 'Rebuilding…'
                  : 'Rebuild embeddings'}
              </button>
            </div>
          )}
        </div>
      </div>
    </MainPanel>
  )
}
