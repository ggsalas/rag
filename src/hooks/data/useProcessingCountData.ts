import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/infrastructure/db'

/**
 * Data hook: Reactive count of documents being processed.
 * ⚠️ Architecture exception: This hook can import db directly (useLiveQuery requirement).
 */
export function useProcessingCountData(): number {
  const count = useLiveQuery(() =>
    db.documents
      .where('status')
      .anyOf(['pending', 'parsing', 'chunking', 'embedding'])
      .count()
  )

  return count ?? 0
}
