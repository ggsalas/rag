import { embed } from '@/services/embedding/embedding.service'
import { searchHybrid } from '@/services/embedding/vector-store'
import { DEFAULT_MAX_RESULTS, DEFAULT_MIN_SCORE } from '@/lib/constants'
import type { SearchResult, HybridWeights } from '@/types/search'

/** Performs hybrid search (BM25 + semantic) within a library */
export async function search(
  query: string,
  libraryId: string,
  maxResults?: number,
  weights?: HybridWeights,
  minScore?: number,
): Promise<SearchResult[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const embedding = await embed(trimmed)

  const hybridResults = await searchHybrid(
    libraryId,
    trimmed,
    embedding,
    maxResults ?? DEFAULT_MAX_RESULTS,
    weights,
  )

  const results: SearchResult[] = hybridResults.map((r) => ({
    chunkId: r.chunkId,
    documentId: r.documentId,
    documentName: r.documentName,
    text: r.text,
    searchText: r.searchText,
    sectionPath: r.sectionPath,
    headingText: r.headingText,
    score: r.score,
    chunkIndex: r.chunkIndex,
  }))

  // Filter by relative score threshold: discard results below minScore% of the top result
  const threshold = minScore ?? DEFAULT_MIN_SCORE
  if (results.length === 0) return results
  const topScore = Math.max(...results.map((r) => r.score))
  return results.filter((r) => r.score >= topScore * (threshold / 100))
}
