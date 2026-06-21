import { db } from '@/infrastructure/db'
import type { Chunk } from '@/types/document'

/** Retrieves all chunks for a library */
export async function getChunksByLibrary(libraryId: string): Promise<Chunk[]> {
  return db.chunks.where('libraryId').equals(libraryId).toArray()
}

/** Retrieves all chunks for a specific document */
export async function getChunksByDocument(documentId: string): Promise<Chunk[]> {
  return db.chunks.where('documentId').equals(documentId).sortBy('chunkIndex')
}

/** Retrieves a specific chunk by library, document, and index */
export async function getChunkByIndex(
  libraryId: string,
  documentId: string,
  chunkIndex: number
): Promise<Chunk | undefined> {
  return db.chunks
    .where('[libraryId+documentId]')
    .equals([libraryId, documentId])
    .filter((c) => c.chunkIndex === chunkIndex)
    .first()
}
