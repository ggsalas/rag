import { embed } from '@/services/embedding/embedding.service'
import { searchHybrid } from '@/services/embedding/vector-store'
import { DEFAULT_TOP_K } from '@/lib/constants'
import type { SearchResult, HybridWeights } from '@/types/search'

/** Performs hybrid search (BM25 + semantic) within a library */
export async function search(
  query: string,
  libraryId: string,
  topK?: number,
  weights?: HybridWeights,
): Promise<SearchResult[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  // 1. Generate embedding for the query
  const embedding = await embed(trimmed)

  // 2. Perform hybrid search (BM25 fulltext + vector similarity)
  const hybridResults = await searchHybrid(
    libraryId,
    trimmed,
    embedding,
    topK ?? DEFAULT_TOP_K,
    weights,
  )

  // 3. Map VectorSearchResult → SearchResult (same shape, explicit mapping for type safety)
  return hybridResults.map((r) => ({
    chunkId: r.chunkId,
    documentId: r.documentId,
    documentName: r.documentName,
    text: r.text,
    score: r.score,
    page: r.page,
    chunkIndex: r.chunkIndex,
  }))
}
