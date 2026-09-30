import type { BenchmarkCase, BenchmarkMetrics } from './search-benchmark.types'
import type { BenchmarkCaseResult, BenchmarkConfigReport } from './search-benchmark.runner'
import { evaluateAll } from './search-benchmark.evaluation'
import { computeLexicalCoverage } from './rerank.service'

/**
 * Query-level lexical abstention experiment: all-or-nothing filtering per query.
 *
 * **Status**: the validated policy (threshold 0.5) has been promoted to
 * production search in `search.service.ts` via `MIN_QUERY_LEXICAL_COVERAGE`.
 * This file is retained as a **diagnostic-only** helper for benchmark
 * analysis — it does NOT alter production search behavior. It complements the
 * per-result abstention in `search-benchmark.abstention.ts` by testing a
 * coarser policy:
 *
 *   For each query, if **at least one** result has lexical coverage ≥ threshold,
 *   preserve the **entire** original ordered result list. If **no** result
 *   qualifies, replace the result list with empty (abstain on the whole query).
 *
 * This models a "trust the query if any evidence looks relevant" policy: once
 * the pipeline finds at least one lexically-relevant chunk, the full ranking
 * is kept (including lower-coverage results that may still be useful context).
 * Only queries where *nothing* looks relevant are silenced.
 *
 * Threshold semantics:
 * - 0.0: every query has at least one result with coverage ≥ 0 → nothing changes
 * - 0.5: queries where no result reaches 50% coverage are silenced
 * - 1.0: queries where no result reaches 100% coverage are silenced
 */

/** Result of applying query-level lexical abstention to a benchmark config report */
export type QueryAbstentionReport = {
  /** The coverage threshold applied (0..1) */
  threshold: number
  /** Aggregate metrics after query-level filtering */
  metrics: BenchmarkMetrics
  /** Per-case results (preserves case ordering from original report) */
  caseResults: BenchmarkCaseResult[]
}

/**
 * Applies query-level lexical abstention to a benchmark config report.
 *
 * For each case, computes lexical coverage for every result. If at least one
 * result has coverage ≥ threshold, the entire original result list is preserved.
 * If no result qualifies, the result list is replaced with empty.
 *
 * Returns the per-case results and re-evaluated metrics.
 *
 * This function is pure and independent of React, Dexie, Orama, and LLM.
 */
export function applyQueryLexicalAbstention(
  cases: BenchmarkCase[],
  report: BenchmarkConfigReport,
  threshold: number,
): QueryAbstentionReport {
  // Build a map from caseId to BenchmarkCase for quick lookup
  const caseMap = new Map<string, BenchmarkCase>()
  for (const c of cases) {
    caseMap.set(c.id, c)
  }

  const filteredCaseResults: BenchmarkCaseResult[] = []
  const resultsByCaseId = new Map<string, typeof report.caseResults[number]['results']>()

  for (const caseResult of report.caseResults) {
    const case_ = caseMap.get(caseResult.caseId)
    if (!case_) {
      // Case not found in the provided cases list — preserve as-is
      filteredCaseResults.push(caseResult)
      resultsByCaseId.set(caseResult.caseId, caseResult.results)
      continue
    }

    // Check if at least one result has coverage >= threshold
    const hasQualifyingResult = caseResult.results.some((result) => {
      const coverage = computeLexicalCoverage(case_.query, result.searchText)
      return coverage >= threshold
    })

    // All-or-nothing: preserve entire list if any result qualifies, else empty
    const finalResults = hasQualifyingResult ? caseResult.results : []

    filteredCaseResults.push({
      caseId: caseResult.caseId,
      results: finalResults,
    })
    resultsByCaseId.set(caseResult.caseId, finalResults)
  }

  // Re-evaluate metrics using the filtered results
  const metrics = evaluateAll(cases, resultsByCaseId, report.metrics.k)

  return {
    threshold,
    metrics,
    caseResults: filteredCaseResults,
  }
}
