import type {
  BenchmarkChunk,
  GradedBenchmarkCase,
  GradedMetrics,
} from './search-benchmark.types'
import { relevanceVector } from './search-benchmark.relevance'

/**
 * Graded retrieval metrics: nDCG@10, Hit@10, Recall@10.
 *
 * These metrics use graded relevance (0, 1, 2) rather than binary hit/miss,
 * providing finer-grained evaluation of ranking quality.
 *
 * Formulas:
 *   DCG@k  = Σ_{i=1}^{k} (2^{rel_i} − 1) / log2(i + 1)
 *   IDCG@k = DCG@k of the ideal (sorted descending) relevance vector
 *   nDCG@k = DCG@k / IDCG@k   (0 when IDCG@k = 0)
 *   Hit@k  = 1 if any rel_i > 0 in top-k, else 0
 *   Recall@k = Σ_{i=1}^{k} (2^{rel_i} − 1) / Σ_{all} (2^{rel_i} − 1)
 *              (0 when total gain = 0)
 */

/**
 * Discounted Cumulative Gain at cutoff k.
 *
 * DCG@k = Σ_{i=1}^{k} (2^{rel_i} − 1) / log2(i + 1)
 *
 * `relevances` is 0-indexed: position 0 = rank 1.
 */
export function dcgAtK(relevances: number[], k: number): number {
  let sum = 0
  const limit = Math.min(relevances.length, k)
  for (let i = 0; i < limit; i++) {
    sum += (Math.pow(2, relevances[i]!) - 1) / Math.log2(i + 2)
  }
  return sum
}

/**
 * Ideal DCG at cutoff k — the DCG of the relevance vector sorted descending.
 */
export function idcgAtK(relevances: number[], k: number): number {
  const sorted = [...relevances].sort((a, b) => b - a)
  return dcgAtK(sorted, k)
}

/**
 * Normalized DCG at cutoff k.
 *
 * nDCG@k = DCG@k / IDCG@k. Returns 0 when IDCG@k = 0 (no relevant documents).
 */
export function ndcgAtK(relevances: number[], k: number): number {
  const ideal = idcgAtK(relevances, k)
  if (ideal === 0) return 0
  return dcgAtK(relevances, k) / ideal
}

/**
 * Hit@k: 1 if any chunk in the top-k has relevance > 0, else 0.
 */
export function hitAtKGraded(relevances: number[], k: number): number {
  const limit = Math.min(relevances.length, k)
  for (let i = 0; i < limit; i++) {
    if (relevances[i]! > 0) return 1
  }
  return 0
}

/**
 * Gain-based Recall@k: fraction of total gain captured in the top-k.
 *
 * Recall@k = Σ_{i=1}^{k} gain_i / Σ_{all} gain_i
 * where gain_i = 2^{rel_i} − 1.
 *
 * Returns 0 when total gain is 0 (no relevant documents at all).
 */
export function recallAtKGraded(relevances: number[], k: number): number {
  let totalGain = 0
  for (const r of relevances) totalGain += Math.pow(2, r) - 1
  if (totalGain === 0) return 0

  let topKGain = 0
  const limit = Math.min(relevances.length, k)
  for (let i = 0; i < limit; i++) {
    topKGain += Math.pow(2, relevances[i]!) - 1
  }
  return topKGain / totalGain
}

/**
 * Per-case graded metrics at k=10.
 */
export function gradedMetricsForCase(
  rankedChunks: BenchmarkChunk[],
  case_: GradedBenchmarkCase,
  k: number = 10,
): { ndcg: number; hit: number; recall: number } {
  const rels = relevanceVector(rankedChunks, case_)
  return {
    ndcg: ndcgAtK(rels, k),
    hit: hitAtKGraded(rels, k),
    recall: recallAtKGraded(rels, k),
  }
}

/**
 * Aggregate graded metrics across all positive cases.
 *
 * `resultsByCaseId` maps each case id to the ordered list of chunks the search
 * pipeline returned for that query. Cases missing from the map are treated as
 * having returned no results.
 */
export function evaluateGraded(
  cases: GradedBenchmarkCase[],
  resultsByCaseId: Map<string, BenchmarkChunk[]>,
  k: number = 10,
): GradedMetrics {
  const positive = cases.filter((c) => c.kind === 'positive')
  if (positive.length === 0) {
    return { ndcgAt10: 0, hitAt10: 0, recallAt10: 0 }
  }

  let ndcgSum = 0
  let hitSum = 0
  let recallSum = 0

  for (const c of positive) {
    const results = resultsByCaseId.get(c.id) ?? []
    const rels = relevanceVector(results, c)
    ndcgSum += ndcgAtK(rels, k)
    hitSum += hitAtKGraded(rels, k)
    recallSum += recallAtKGraded(rels, k)
  }

  const n = positive.length
  return {
    ndcgAt10: ndcgSum / n,
    hitAt10: hitSum / n,
    recallAt10: recallSum / n,
  }
}
