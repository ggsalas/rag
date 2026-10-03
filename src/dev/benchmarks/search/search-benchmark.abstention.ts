import type { BenchmarkCase, BenchmarkMetrics } from './search-benchmark.types'
import type { BenchmarkCaseResult, BenchmarkConfigReport } from './search-benchmark.runner'
import { evaluateAll } from './search-benchmark.evaluation'
import { computeLexicalCoverage } from '@/lib/lexical-ranking'

/**
 * Lexical abstention experiment: post-hoc filtering of benchmark results based
 * on query-text lexical coverage.
 *
 * This is a **diagnostic-only** helper for benchmark analysis. It does NOT
 * alter production search behavior. The goal is to compare filtering results
 * with lexical coverage thresholds (0%, 50%, 100%) so the user can decide
 * whether `coverage >= 50%` improves negative rejection without hurting
 * positive recall.
 *
 * For each case in a `BenchmarkConfigReport`, results are filtered to keep
 * only those where `computeLexicalCoverage(case.query, result.searchText) >=
 * threshold`. The filtered results are then re-evaluated using the existing
 * `evaluateAll` helper to produce metrics.
 *
 * Threshold semantics:
 * - 0.0: no filtering (baseline, identical to original report)
 * - 0.5: keep results where at least 50% of meaningful query tokens appear
 * - 1.0: keep only results where all meaningful query tokens appear
 */

/** Result of applying a lexical coverage threshold to a benchmark config report */
export type AbstentionReport = {
  /** The coverage threshold applied (0..1) */
  threshold: number
  /** Aggregate metrics after filtering */
  metrics: BenchmarkMetrics
  /** Per-case filtered results (preserves case ordering from original report) */
  caseResults: BenchmarkCaseResult[]
}

/**
 * Applies a lexical coverage threshold to a benchmark config report.
 *
 * For each case, filters results to keep only those where
 * `computeLexicalCoverage(case.query, result.searchText) >= threshold`.
 * Returns the filtered per-case results and re-evaluated metrics.
 *
 * This function is pure and independent of React, Dexie, Orama, and LLM.
 */
export function applyLexicalAbstention(
  cases: BenchmarkCase[],
  report: BenchmarkConfigReport,
  threshold: number,
): AbstentionReport {
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

    // Filter results by lexical coverage threshold
    const filtered = caseResult.results.filter((result) => {
      const coverage = computeLexicalCoverage(case_.query, result.searchText)
      return coverage >= threshold
    })

    filteredCaseResults.push({
      caseId: caseResult.caseId,
      results: filtered,
    })
    resultsByCaseId.set(caseResult.caseId, filtered)
  }

  // Re-evaluate metrics using the filtered results
  const metrics = evaluateAll(cases, resultsByCaseId, report.metrics.k)

  return {
    threshold,
    metrics,
    caseResults: filteredCaseResults,
  }
}
