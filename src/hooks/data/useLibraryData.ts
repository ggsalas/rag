import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/infrastructure/db'

/**
 * Data hook: Reactive query for a single library by ID.
 * ⚠️ Architecture exception: This hook can import db directly (useLiveQuery requirement).
 */
export function useLibraryData(libraryId: string | undefined) {
  const library = useLiveQuery(
    () => (libraryId ? db.libraries.get(libraryId) : undefined),
    [libraryId],
  )

  return {
    library: library ?? null,
    loading: library === undefined,
  }
}
