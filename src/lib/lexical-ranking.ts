import type { SearchResult } from '@/types/search'
import { ENGLISH_STOP_WORDS } from '@/lib/stop-words'

/**
 * Number of candidates to retrieve from Orama before reranking.
 * Exported so search.service.ts and tests share a single source of truth.
 *
 * EXPERIMENT: bumped from 20 → 100 to test whether correct chunks are
 * present deeper in the index (benchmark case `toxic-album` only hit at
 * ranks 13–17 or beyond top-20; `children-sons` is an unanswerable source case
 * because the source article does not state the required anchors). The
 * reranker still returns only the caller's requested `maxResults`; the larger
 * pool only widens the internal candidate set. After rerunning the benchmark
 * we will decide whether 100 is acceptable for normal use.
 */
export const RERANK_CANDIDATE_POOL = 100

/**
 * Conservative English stop words ignored when computing query-token coverage.
 * Single source of truth lives in `src/lib/stop-words.ts`; this module
 * re-exports it under a short local alias for readability.
 */
const STOP_WORDS: ReadonlySet<string> = ENGLISH_STOP_WORDS

/** Weights for the reranking formula. Kept conservative so the original
 *  Orama hybrid score remains the dominant signal. */
const W_COVERAGE = 0.15
const W_PHRASE = 0.20
const W_HEADING = 0.10

/**
 * Reranking formula (documented, deterministic):
 *
 *   rerankScore = originalScore * (1
 *                  + W_COVERAGE * coverage
 *                  + W_PHRASE   * phraseHit
 *                  + W_HEADING  * headingHit)
 *
 * Where:
 *   coverage  = |non-stop query tokens found in searchText| / |non-stop query tokens|
 *               (0..1; 1 when all meaningful query tokens appear in the chunk text)
 *   phraseHit = 1.0 if the full (trimmed, lowercased) query appears as a contiguous
 *               substring of searchText, else 0.0
 *   headingHit = 1.0 if any non-stop query token appears in headingText or any
 *                element of sectionPath (case-insensitive), else 0.0
 *
 * Maximum possible boost: (W_COVERAGE + W_PHRASE + W_HEADING) = 0.45,
 * so originalScore is always the dominant signal.
 */

/** Extracts non-stop lowercased tokens from a string */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0 && !STOP_WORDS.has(t))
}

/**
 * Computes the fraction of meaningful (non-stop) query tokens found in the
 * candidate searchText. Returns a value in 0..1.
 *
 * - 0 means none of the meaningful query tokens appear in the text.
 * - 1 means every meaningful query token appears at least once.
 * - Returns 0 when the query contains only stop words (no meaningful tokens).
 *
 * Uses the same stop-word list and tokenisation as the ranking function so the
 * value is consistent with the coverage term inside
 * `computeLexicalRelevanceScore`.
 */
export function computeLexicalCoverage(query: string, searchText: string): number {
  const queryTokens = tokenize(query)
  if (queryTokens.length === 0) return 0
  const textLower = searchText.toLowerCase()
  const matched = queryTokens.filter((t) => textLower.includes(t))
  return matched.length / queryTokens.length
}

/**
 * Computes the lexical relevance score for a single candidate.
 * Exported for unit testing the formula in isolation.
 */
export function computeLexicalRelevanceScore(
  query: string,
  candidate: Pick<SearchResult, 'searchText' | 'headingText' | 'sectionPath' | 'score'>,
): number {
  const queryTokens = tokenize(query)
  const textLower = candidate.searchText.toLowerCase()

  // Coverage: fraction of non-stop query tokens present in searchText
  const coverage = computeLexicalCoverage(query, candidate.searchText)

  // Exact phrase bonus
  const queryLower = query.trim().toLowerCase()
  const phraseHit = queryLower.length > 0 && textLower.includes(queryLower) ? 1 : 0

  // Heading / sectionPath bonus
  let headingHit = 0
  if (queryTokens.length > 0) {
    const headingPool = [
      candidate.headingText.toLowerCase(),
      ...candidate.sectionPath.map((s) => s.toLowerCase()),
    ].join(' ')
    headingHit = queryTokens.some((t) => headingPool.includes(t)) ? 1 : 0
  }

  return (
    candidate.score *
    (1 + W_COVERAGE * coverage + W_PHRASE * phraseHit + W_HEADING * headingHit)
  )
}

/**
 * Ranks a list of search results by lexical relevance, using a conservative
 * lexical/metadata signal on top of the original Orama hybrid score.
 *
 * The original `score` field is preserved on each result (it remains the
 * Orama confidence for display/threshold semantics). An optional
 * `rerankScore` field is added so callers can inspect the boosted value.
 */
export function rankByLexicalRelevance(query: string, candidates: SearchResult[]): SearchResult[] {
  if (candidates.length === 0) return []

  const scored = candidates.map((c) => ({
    result: c,
    rerankScore: computeLexicalRelevanceScore(query, c),
  }))

  // Sort by rerankScore descending. Break ties deterministically by chunkId
  // so the ordering is stable across runs.
  scored.sort((a, b) => {
    if (b.rerankScore !== a.rerankScore) return b.rerankScore - a.rerankScore
    return a.result.chunkId.localeCompare(b.result.chunkId)
  })

  return scored.map(({ result, rerankScore }) => ({
    ...result,
    rerankScore,
  }))
}
