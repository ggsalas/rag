import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/infrastructure/db'
import type { DocumentStatus } from '@/types/document'

const PROCESSING_STATUSES: DocumentStatus[] = [
  'pending',
  'parsing',
  'chunking',
  'embedding',
]

/**
 * Data hook: Reactive count of documents being processed.
 * Pass a libraryId to scope the count to a specific library.
 * ⚠️ Architecture exception: This hook can import db directly (useLiveQuery requirement).
 */
export function useProcessingCountData(libraryId?: string): number {
  const count = useLiveQuery(
    () =>
      libraryId
        ? db.documents
            .where('libraryId')
            .equals(libraryId)
            .and((d) => PROCESSING_STATUSES.includes(d.status))
            .count()
        : db.documents.where('status').anyOf(PROCESSING_STATUSES).count(),
    [libraryId],
  )

  return count ?? 0
}
