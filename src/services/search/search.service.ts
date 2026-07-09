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
    score: r.score,
    chunkIndex: r.chunkIndex,
    headingText: r.headingText,
    sectionPath: r.sectionPath,
  }))

  if (results.length === 0) return results

  // Two-tier filter:
  //   • Relative cutoff (user-tunable): drop chunks below `minScore`% of the top result.
  //   • Absolute cutoff: drop anything below `MIN_ABSOLUTE_SCORE` — prevents the
  //     "best of the bad" case where the only match is a stem hit in unrelated
  //     content, which would otherwise dominate and mislead the LLM.
  const threshold = minScore ?? DEFAULT_MIN_SCORE
  const topScore = Math.max(...results.map((r) => r.score))
  const floor = Math.max(topScore * (threshold / 100), MIN_ABSOLUTE_SCORE)
  return results.filter((r) => r.score >= floor)
}
