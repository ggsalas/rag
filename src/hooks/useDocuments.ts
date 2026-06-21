import { useCallback } from 'react'
import { useDocumentsData } from './data/useDocumentsData'
import * as documentService from '@/services/document.service'
import { ingestDocuments } from '@/services/ingest/ingest.service'

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
    await documentService.deleteDocument(id)
    // No refetch needed - useLiveQuery in data hook updates automatically
  }, [])

  return {
    documents,
    loading,
    uploadFiles,
    deleteDocument,
  }
}
