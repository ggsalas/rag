import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/infrastructure/db'

/**
 * Data hook: Reactive query for documents by library.
 * ⚠️ Architecture exception: This hook can import db directly (useLiveQuery requirement).
 * All other hooks/components MUST use this instead of importing db.
 */
export function useDocumentsData(libraryId: string) {
  const documents = useLiveQuery(
    () =>
      db.documents
        .where('libraryId')
        .equals(libraryId)
        .reverse()
        .sortBy('createdAt'),
    [libraryId],
  )

  return {
    documents: documents ?? [],
    loading: documents === undefined,
  }
}
