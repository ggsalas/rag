import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/infrastructure/db'

/**
 * Data hook: Reactive query for a specific chunk by library, document, and index.
 * ⚠️ Architecture exception: This hook can import db directly (useLiveQuery requirement).
 */
export function useChunkData(
  libraryId: string | undefined,
  documentId: string | undefined,
  chunkIndex: number | null
) {
  const chunk = useLiveQuery(
    () => {
      if (!libraryId || !documentId || chunkIndex === null) return undefined
      
      return db.chunks
        .where('[libraryId+documentId]')
        .equals([libraryId, documentId])
        .filter((c) => c.chunkIndex === chunkIndex)
        .first()
    },
    [libraryId, documentId, chunkIndex]
  )

  return {
    chunk: chunk ?? null,
    loading: chunk === undefined && chunkIndex !== null,
  }
}
