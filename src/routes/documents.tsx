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
  const modelStatus = useAppStore((s) => s.modelStatus)
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
      <div className="flex-1 flex items-center justify-center p-6">
        <DropZone
          onFiles={(files) => uploadFiles(files)}
          disabled={modelStatus === 'loading'}
        />
      </div>
    </MainPanel>
  )
}
