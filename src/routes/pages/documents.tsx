import { useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router'
import { useDocuments } from '@/hooks/useDocuments'
import { DropZone } from '@/components/documents/DropZone'
import { useAppStore } from '@/store/app.store'
import { MainPanel } from '@/components/sidebar/MainPanel'
import { useIndexedDocumentCountData } from '@/hooks/data/useIndexedDocumentCountData'
import { useProcessingCountData } from '@/hooks/data/useProcessingCountData'

export function DocumentsPage() {
  const { libraryId } = useParams<{ libraryId: string }>()
  const { uploadFiles } = useDocuments(libraryId!)
  const embeddingStatus = useAppStore((s) => s.embeddingStatus)
  const navigate = useNavigate()

  const { count } = useIndexedDocumentCountData(libraryId!)
  const processingCount = useProcessingCountData(libraryId)
  const hadProcessingRef = useRef(false)

  useEffect(() => {
    if (processingCount > 0) {
      hadProcessingRef.current = true
      return
    }
    if (hadProcessingRef.current && count > 0) {
      navigate(`/libraries/${libraryId}/search`, { replace: true })
    }
  }, [processingCount, count, libraryId, navigate])

  return (
    <MainPanel noAddDocment>
      <div className="flex flex-col h-full overflow-y-auto">
        <div className="p-6 min-h-[50vh]">
          <DropZone
            onFiles={(files) => uploadFiles(files)}
            disabled={embeddingStatus === 'loading'}
            className="w-full h-full min-h-[calc(50vh-3rem)]"
          />
        </div>

        <div className="border-t border-border px-8 py-8 space-y-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            How documents are processed
          </h2>

          <div className="grid grid-cols-3 gap-6">
            <div>
              <p className="text-sm font-medium text-foreground mb-1">PDF</p>
              <p className="text-sm text-muted-foreground">
                Text is extracted page by page and split into sentence-based chunks. Each chunk keeps its page number for reference.
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-foreground mb-1">Markdown</p>
              <p className="text-sm text-muted-foreground">
                Split by headings — each section becomes its own chunk. Long sections are further divided by paragraph.
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-foreground mb-1">TXT / DOCX</p>
              <p className="text-sm text-muted-foreground">
                Split by paragraphs. Chunks overlap by 100 characters so context is not lost at boundaries.
              </p>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            All chunks are embedded using <span className="font-mono">all-MiniLM-L6-v2</span> (384 dimensions) and stored locally — nothing leaves your device.
          </p>
        </div>
      </div>
    </MainPanel>
  )
}
