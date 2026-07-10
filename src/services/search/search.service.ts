import { embed } from '@/services/embedding/embedding.service'
import { searchHybrid, type VectorSearchResult } from '@/services/embedding/vector-store'
import {
  DEFAULT_MAX_RESULTS,
  DEFAULT_MIN_SCORE,
  MIN_ABSOLUTE_SCORE,
  HYDE_ENABLED,
} from '@/lib/constants'
import type { SearchResult, HybridWeights } from '@/types/search'
import { searchWithHyDE } from './hyde.service'

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

  const topK = maxResults ?? DEFAULT_MAX_RESULTS
  const vectorWeight = weights?.vector ?? 0.5

  // HyDE only helps when the vector channel actually contributes to the score.
  // For a keyword-only preset (`vector: 0`), the extra LLM+embedding work is
  // wasted — skip it and go straight to the plain path.
  const useHyDE = HYDE_ENABLED && vectorWeight > 0

  let rawResults: VectorSearchResult[]
  if (useHyDE) {
    try {
      rawResults = await searchWithHyDE(trimmed, libraryId, topK, weights)
    } catch (err) {
      // Any HyDE failure (LLM error, timeout, empty generation) falls back to
      // plain search. HyDE should never degrade the user experience.
      console.warn('HyDE search failed, falling back to plain search:', err)
      rawResults = await searchPlain(trimmed, libraryId, topK, weights)
    }
  } else {
    rawResults = await searchPlain(trimmed, libraryId, topK, weights)
  }

  const results: SearchResult[] = rawResults.map((r) => ({
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
  //
  // The absolute floor is bypassed on the HyDE path: rrfFuse normalises scores
  // so the top is always 1.0 by construction, making MIN_ABSOLUTE_SCORE
  // ineffective (the top always passes it regardless of match quality). The
  // relative percent cutoff still works normally.
  const threshold = minScore ?? DEFAULT_MIN_SCORE
  const topScore = Math.max(...results.map((r) => r.score))
  const absoluteFloor = useHyDE ? 0 : MIN_ABSOLUTE_SCORE
  const floor = Math.max(topScore * (threshold / 100), absoluteFloor)
  return results.filter((r) => r.score >= floor)
}

/**
 * Plain (non-HyDE) search path. Kept as a separate function so HyDE can be
 * fully removed by deleting hyde.service.ts + the `if (useHyDE)` branch above.
 */
async function searchPlain(
  query: string,
  libraryId: string,
  topK: number,
  weights?: HybridWeights,
): Promise<VectorSearchResult[]> {
  const embedding = await embed(query)
  return searchHybrid(libraryId, query, embedding, topK, weights)
}
