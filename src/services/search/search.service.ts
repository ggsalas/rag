import { embed } from '@/services/embedding/embedding.service'
import { searchHybrid } from '@/services/embedding/vector-store'
import {
  DEFAULT_MAX_RESULTS,
  RERANK_CANDIDATES_CROSS_ENCODER,
  RERANKER_ABSTENTION_THRESHOLD,
} from '@/lib/constants'
import type { SearchResult, HybridWeights } from '@/types/search'
import {
  rerankWithCrossEncoder,
  isRerankerReady,
} from './cross-encoder-reranker.service'
import { rerank, RERANK_CANDIDATE_POOL } from './rerank.service'

/**
 * Error thrown when the search pipeline cannot run because a required model
 * is not ready. The UI layer should catch this and surface a retry action.
 */
export class SearchModelNotReadyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SearchModelNotReadyError'
  }
}

/**
 * Performs hybrid search (BM25 + semantic) within a library, followed by
 * lexical reranking and cross-encoder reranking.
 *
 * Pipeline:
 *   1. Embed query
 *   2. Retrieve RERANK_CANDIDATE_POOL (100) candidates from Orama (hybrid)
 *   3. Filter empty chunks
 *   4. Lexical rerank (coverage, phrase, heading boosts)
 *   5. Take top RERANK_CANDIDATES_CROSS_ENCODER (40) for cross-encoder
 *   6. Rerank with cross-encoder (MUST be loaded — no fallback)
 *   7. Truncate to maxResults (default 10)
 *   8. Abstention: filter by RERANKER_ABSTENTION_THRESHOLD (logit -6.0)
 *
 * If either the embedding model or the cross-encoder is not ready, the
 * function throws a `SearchModelNotReadyError`. There is NO degraded-mode
 * fallback: the cross-encoder is the only validated abstention mechanism,
 * and returning results without it would silently surface irrelevant chunks.
 */
export async function search(
  query: string,
  libraryId: string,
  maxResults?: number,
  weights?: HybridWeights,
): Promise<SearchResult[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  // Gate: both embedding and cross-encoder must be ready before searching.
  // The embedding model is checked implicitly by calling embed() — if it
  // fails, the error propagates. The cross-encoder is checked explicitly.
  if (!isRerankerReady()) {
    throw new SearchModelNotReadyError(
      'Cross-encoder model is not ready. Search is unavailable until the model finishes loading.',
    )
  }

  const embedding = await embed(trimmed)

  // Retrieve a wide candidate pool for lexical reranking.
  const effectiveTopK = Math.max(
    RERANK_CANDIDATE_POOL,
    maxResults ?? DEFAULT_MAX_RESULTS,
  )

  const hybridResults = await searchHybrid(
    libraryId,
    trimmed,
    embedding,
    effectiveTopK,
    weights,
  )

  const candidates: SearchResult[] = hybridResults
    .map((r) => ({
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
    // Guard: drop parser-generated empty chunks so they never reach the user.
    .filter((r) => r.text.trim().length > 0 && r.searchText.trim().length > 0)

  if (candidates.length === 0) return []

  // Lexical reranking: boost candidates by query-term coverage, phrase match,
  // and heading/sectionPath alignment. This reorders the pool before the
  // cross-encoder sees it.
  const lexicallyReranked = rerank(trimmed, candidates)

  // Take the top candidates for cross-encoder reranking.
  const ceCandidates = lexicallyReranked.slice(0, RERANK_CANDIDATES_CROSS_ENCODER)

  // Cross-encoder reranking (already gated above — this path always runs).
  const reranked = await rerankWithCrossEncoder(trimmed, ceCandidates)

  // Truncate to maxResults
  const limit = maxResults ?? DEFAULT_MAX_RESULTS
  const truncated = reranked.slice(0, limit)

  // Abstention: filter by cross-encoder logit threshold.
  if (truncated.length > 0) {
    const hasQualifying = truncated.some(
      (r) => (r.rerankScore ?? -Infinity) >= RERANKER_ABSTENTION_THRESHOLD,
    )
    if (!hasQualifying) return []
  }

  return truncated
}
