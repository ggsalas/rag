import type {
  BenchmarkCase,
  BenchmarkChunk,
  BenchmarkMetrics,
} from './search-benchmark.types'

/**
 * Pure evaluation helpers for scoring search results against benchmark cases.
 *
 * These functions are intentionally decoupled from Dexie, Orama, React, and the
 * LLM — they only depend on the `BenchmarkChunk` structural shape, which
 * `SearchResult` from `@/types/search` satisfies.
 *
 * Hit determination uses **required anchors** only: a chunk is a hit when it
 * contains ALL required anchors (case-insensitive substring match against
 * `text` and `searchText`). **Supporting anchors** are surfaced via
 * `matchedSupportingAnchors` for diagnostics but never independently make a
 * chunk a hit.
 *
 * This is a coarse proxy for "the chunk contains the fact the question asks
 * about" — good enough to compare weight presets and ranking strategies, but
 * provisional until actual chunk IDs are labeled.
 */

/**
 * Normalizes a string for anchor matching: Unicode NFC normalization, collapse
 * all whitespace runs (spaces, tabs, newlines, etc.) to a single space, trim,
 * and lowercase. This makes matching resilient to PDF whitespace/layout
 * artifacts (e.g. names split across lines or columns).
 */
function normalize(s: string): string {
  return s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Returns true when `anchor` appears as a case-insensitive substring in either
 * the chunk's display text or its retrieval text.
 *
 * Both anchor and candidate text are normalized (Unicode NFC + whitespace
 * collapsed) before comparison, so anchors split by newlines/tabs in PDF
 * extractions still match.
 */
export function anchorMatch(chunk: BenchmarkChunk, anchor: string): boolean {
  if (!anchor) return false
  const needle = normalize(anchor)
  if (!needle) return false
  return (
    normalize(chunk.text).includes(needle) ||
    normalize(chunk.searchText).includes(needle)
  )
}

/** Returns the subset of required anchors matched by a single chunk */
export function matchedRequiredAnchors(
  chunk: BenchmarkChunk,
  case_: BenchmarkCase,
): string[] {
  return case_.requiredAnchors.filter((a) => anchorMatch(chunk, a))
}

/** Returns the subset of supporting anchors matched by a single chunk */
export function matchedSupportingAnchors(
  chunk: BenchmarkChunk,
  case_: BenchmarkCase,
): string[] {
  return case_.supportingAnchors.filter((a) => anchorMatch(chunk, a))
}

/**
 * Returns all matched anchors (required + supporting) for display/diagnostics.
 */
export function matchedAnchors(
  chunk: BenchmarkChunk,
  case_: BenchmarkCase,
): string[] {
  return [
    ...matchedRequiredAnchors(chunk, case_),
    ...matchedSupportingAnchors(chunk, case_),
  ]
}

/**
 * A chunk is a "hit" when it contains ALL required anchors.
 *
 * Supporting anchors are ignored for hit determination — they may be present
 * but do not independently qualify a chunk as a hit.
 *
 * For negative cases (no required anchors), a chunk is never a hit — negative
 * cases measure false positives via result-list emptiness, not anchor matching.
 */
export function isHit(chunk: BenchmarkChunk, case_: BenchmarkCase): boolean {
  if (case_.requiredAnchors.length === 0) return false
  return matchedRequiredAnchors(chunk, case_).length === case_.requiredAnchors.length
}

/**
 * Hit@k: 1 if any chunk in the top-k is a hit, 0 otherwise.
 *
 * For negative cases (no required anchors), returns 1 when any chunk is
 * returned at all — i.e. the search produced a false positive.
 */
export function hitAtK(
  results: BenchmarkChunk[],
  case_: BenchmarkCase,
  k: number,
): number {
  const topK = results.slice(0, k)
  if (topK.length === 0) return 0
  if (case_.kind === 'negative') return 1
  return topK.some((c) => isHit(c, case_)) ? 1 : 0
}

/**
 * Recall@k: fraction of required anchors found in the top-k chunks (union).
 *
 * Only required anchors count toward recall — supporting anchors are diagnostic
 * and do not affect this metric.
 *
 * For negative cases or cases with no required anchors, returns 0.
 */
export function recallAtK(
  results: BenchmarkChunk[],
  case_: BenchmarkCase,
  k: number,
): number {
  if (case_.requiredAnchors.length === 0) return 0
  const topK = results.slice(0, k)
  const found = new Set<string>()
  for (const chunk of topK) {
    for (const anchor of case_.requiredAnchors) {
      if (anchorMatch(chunk, anchor)) found.add(anchor.toLowerCase())
    }
  }
  // Deduplicate anchors case-insensitively for the denominator too
  const total = new Set(case_.requiredAnchors.map((a) => a.toLowerCase())).size
  return total === 0 ? 0 : found.size / total
}

/**
 * Precision@k: fraction of top-k chunks that are hits.
 *
 * For negative cases, every returned chunk counts as a false positive, so
 * precision is 0 when any chunk is returned and 1 when the list is empty.
 */
export function precisionAtK(
  results: BenchmarkChunk[],
  case_: BenchmarkCase,
  k: number,
): number {
  const topK = results.slice(0, k)
  if (topK.length === 0) return case_.kind === 'negative' ? 1 : 0
  if (case_.kind === 'negative') return 0
  const hits = topK.filter((c) => isHit(c, case_)).length
  return hits / k
}

/**
 * Mean Reciprocal Rank: 1/rank of the first hit, or 0 when no hit is found.
 *
 * For negative cases, returns 1 when results are empty (correctly nothing
 * found) and 0 otherwise — equivalent to "no false positive".
 */
export function reciprocalRank(
  results: BenchmarkChunk[],
  case_: BenchmarkCase,
): number {
  if (case_.kind === 'negative') return results.length === 0 ? 1 : 0
  for (let i = 0; i < results.length; i++) {
    if (isHit(results[i]!, case_)) return 1 / (i + 1)
  }
  return 0
}

/**
 * False-positive rate across negative cases: fraction of negative cases that
 * returned at least one chunk.
 */
export function falsePositiveRate(
  resultsByCaseId: Map<string, BenchmarkChunk[]>,
  negativeCases: BenchmarkCase[],
): number {
  if (negativeCases.length === 0) return 0
  const falsePositives = negativeCases.filter((c) => {
    const results = resultsByCaseId.get(c.id) ?? []
    return results.length > 0
  }).length
  return falsePositives / negativeCases.length
}

/**
 * Aggregate metrics across a full benchmark run.
 *
 * `resultsByCaseId` maps each case id to the ordered list of chunks the search
 * pipeline returned for that query. Cases missing from the map are treated as
 * having returned no results.
 */
export function evaluateAll(
  cases: BenchmarkCase[],
  resultsByCaseId: Map<string, BenchmarkChunk[]>,
  k: number,
): BenchmarkMetrics {
  const positive = cases.filter((c) => c.kind === 'positive')
  const negative = cases.filter((c) => c.kind === 'negative')

  const hitSum = positive.reduce(
    (acc, c) => acc + hitAtK(resultsByCaseId.get(c.id) ?? [], c, k),
    0,
  )
  const recallSum = positive.reduce(
    (acc, c) => acc + recallAtK(resultsByCaseId.get(c.id) ?? [], c, k),
    0,
  )
  const precisionSum = positive.reduce(
    (acc, c) => acc + precisionAtK(resultsByCaseId.get(c.id) ?? [], c, k),
    0,
  )
  const mrrSum = positive.reduce(
    (acc, c) => acc + reciprocalRank(resultsByCaseId.get(c.id) ?? [], c),
    0,
  )

  const n = positive.length || 1
  return {
    hitAtK: hitSum / n,
    recallAtK: recallSum / n,
    precisionAtK: precisionSum / n,
    mrr: mrrSum / n,
    falsePositiveRate: falsePositiveRate(resultsByCaseId, negative),
    k,
  }
}
