import { useCallback } from 'react'
import { useDocumentsData } from './data/useDocumentsData'
import * as documentService from '@/services/document.service'
import { ingestDocuments } from '@/services/ingest/ingest.service'
import { toast } from 'sonner'

/** Business hook: Document management for a library */
export function useDocuments(libraryId: string) {
  const { documents, loading } = useDocumentsData(libraryId)

  const uploadFiles = useCallback(
    async (files: File[]) => {
      await ingestDocuments(files, libraryId)
      // No refetch needed - useLiveQuery in data hook updates automatically
    },
    [libraryId],
  )

  const deleteDocument = useCallback(async (id: string) => {
    try {
      await documentService.deleteDocument(id)
      toast.success('Document deleted')
    } catch (error) {
      console.error('Failed to delete document:', error)
      toast.error('Failed to delete document')
      throw error
    }
  }, [])

  return {
    documents,
    loading,
    uploadFiles,
    deleteDocument,
  }
}
