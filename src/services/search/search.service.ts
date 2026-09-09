import { embed } from '@/services/embedding/embedding.service'
import { searchHybrid } from '@/services/embedding/vector-store'
import {
  DEFAULT_MAX_RESULTS,
  DEFAULT_MIN_SCORE,
  MIN_ABSOLUTE_SCORE,
} from '@/lib/constants'
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
  // Also apply absolute score floor to prevent returning the best of irrelevant results
  const threshold = minScore ?? DEFAULT_MIN_SCORE
  if (results.length === 0) return results
  const topScore = Math.max(...results.map((r) => r.score))
  const relativeThreshold = topScore * (threshold / 100)
  return results.filter(
    (r) => r.score >= relativeThreshold && r.score >= MIN_ABSOLUTE_SCORE,
  )
}
