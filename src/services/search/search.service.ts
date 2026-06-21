import { embed } from '@/services/embedding/embedding.service'
import { searchByVector } from '@/services/embedding/vector-store'
import { DEFAULT_TOP_K } from '@/lib/constants'
import type { SearchResult } from '@/types/search'

/** Performs semantic search within a library using vector embeddings */
export async function search(
  query: string,
  libraryId: string,
  topK?: number
): Promise<SearchResult[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  // 1. Generate embedding for the query
  const embedding = await embed(trimmed)

  // 2. Search Orama index for this library
  const vectorResults = await searchByVector(libraryId, embedding, topK ?? DEFAULT_TOP_K)

  // 3. Map VectorSearchResult → SearchResult (same shape, explicit mapping for type safety)
  return vectorResults.map((r) => ({
    chunkId: r.chunkId,
    documentId: r.documentId,
    documentName: r.documentName,
    text: r.text,
    score: r.score,
    page: r.page,
    chunkIndex: r.chunkIndex,
  }))
}
