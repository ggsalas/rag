import { Navigate, useParams } from 'react-router'
import { useIndexedDocumentCountData } from '@/hooks/data/useIndexedDocumentCountData'

/** Redirects to search if indexed docs exist, otherwise to documents (DropZone) */
export function LibraryRedirect() {
  const { libraryId } = useParams<{ libraryId: string }>()
  const { count, loading } = useIndexedDocumentCountData(libraryId ?? '')

  if (!libraryId || loading) return null

  const target =
    count > 0
      ? `/libraries/${libraryId}/search`
      : `/libraries/${libraryId}/documents`

  return <Navigate to={target} replace />
}
