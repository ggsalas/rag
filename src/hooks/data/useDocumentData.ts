import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/infrastructure/db'

/**
 * Data hook: Reactive query for a single document by ID.
 * ⚠️ Architecture exception: This hook can import db directly (useLiveQuery requirement).
 */
export function useDocumentData(documentId: string | undefined) {
  const document = useLiveQuery(
    () => documentId ? db.documents.get(documentId) : undefined,
    [documentId]
  )

  return {
    document: document ?? null,
    loading: document === undefined,
  }
}
