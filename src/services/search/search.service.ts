import { embed } from '@/services/embedding/embedding.service'
import { searchHybrid } from '@/services/embedding/vector-store'
import {
  DEFAULT_MAX_RESULTS,
  RERANK_CANDIDATES_CROSS_ENCODER,
  RERANKER_ABSTENTION_THRESHOLD,
} from '@/lib/constants'
import type { SearchResult, HybridWeights } from '@/types/search'
import { rerank, RERANK_CANDIDATE_POOL } from './rerank.service'
import {
  rerankWithCrossEncoder,
  isRerankerReady,
  loadRerankerModel,
} from './cross-encoder-reranker.service'

/**
 * Performs hybrid search (BM25 + semantic) within a library.
 *
 * Pipeline:
 *   1. Embed query and retrieve RERANK_CANDIDATE_POOL candidates from Orama
 *   2. Filter empty chunks
 *   3. Apply lexical/metadata reranker (always active, fast)
 *   4. Take top RERANK_CANDIDATES_CROSS_ENCODER candidates
 *   5. Apply cross-encoder reranker (if loaded; graceful degradation otherwise)
 *   6. Truncate to maxResults
 *   7. Abstention: if cross-encoder is loaded, filter by RERANKER_ABSTENTION_THRESHOLD
 *
 * The cross-encoder is loaded on demand (first search that triggers it). If it
 * fails to load, the pipeline degrades gracefully: results are returned using
 * the lexical reranker only, with no abstention threshold.
 */
export async function search(
  query: string,
  libraryId: string,
  maxResults?: number,
  weights?: HybridWeights,
): Promise<SearchResult[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const embedding = await embed(trimmed)

  // Retrieve a larger candidate pool so the reranker has room to reorder.
  const effectiveTopK = Math.max(RERANK_CANDIDATE_POOL, maxResults ?? DEFAULT_MAX_RESULTS)

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

  // Step 3: Lexical/metadata reranker (always active, fast)
  const lexicallyReranked = rerank(trimmed, candidates)

  // Step 4: Take top candidates for cross-encoder
  const ceCandidatePool = lexicallyReranked.slice(0, RERANK_CANDIDATES_CROSS_ENCODER)

  // Step 5: Cross-encoder reranker (with graceful degradation)
  let finalResults: SearchResult[]
  if (isRerankerReady()) {
    // Cross-encoder is loaded: use it for reranking
    finalResults = await rerankWithCrossEncoder(trimmed, ceCandidatePool)
  } else {
    // Cross-encoder not loaded: try to load it (non-blocking for this search)
    // We don't await the load because it would block the search. Instead, we
    // return results with lexical reranking only. The next search will use the
    // cross-encoder if the load succeeds.
    // Note: no progress callback here because services can't import from store/.
    // The UI can check isRerankerReady() and isRerankerDegraded() for status.
    loadRerankerModel().catch(() => {
      // Silently ignore load failures; degradation is handled by isRerankerReady()
    })
    finalResults = ceCandidatePool
  }

  // Step 6: Truncate to maxResults
  const limit = maxResults ?? DEFAULT_MAX_RESULTS
  const truncated = finalResults.slice(0, limit)

  // Step 7: Abstention (only if cross-encoder is loaded)
  if (isRerankerReady() && truncated.length > 0) {
    // The cross-encoder sets rerankScore to the logit. Filter by threshold.
    const hasQualifying = truncated.some(
      (r) => (r.rerankScore ?? -Infinity) >= RERANKER_ABSTENTION_THRESHOLD,
    )
    if (!hasQualifying) return []
  }

  return truncated
}
