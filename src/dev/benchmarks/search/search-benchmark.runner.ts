import type { SearchResult, HybridWeights } from '@/types/search'
import type { BenchmarkCase, BenchmarkMetrics } from './search-benchmark.types'
import type { BenchmarkConfig } from './search-benchmark.config'
import { evaluateAll } from './search-benchmark.evaluation'

/**
 * Signature of the injected search function.
 *
 * Matches the production `search` service in `search.service.ts` so callers can
 * pass it directly — but the runner never imports that module, keeping it free
 * of React, Dexie, Orama, and LLM dependencies.
 */
export type BenchmarkSearchFn = (
  query: string,
  libraryId: string,
  maxResults?: number,
  weights?: HybridWeights,
  minScore?: number,
  minAbsoluteScore?: number,
) => Promise<SearchResult[]>

/** Per-case output: the case id plus the ordered results the search returned */
export type BenchmarkCaseResult = {
  caseId: string
  results: SearchResult[]
}

/** Report for a single configuration: config, aggregate metrics, per-case results */
export type BenchmarkConfigReport = {
  config: BenchmarkConfig
  metrics: BenchmarkMetrics
  caseResults: BenchmarkCaseResult[]
}

/** Top-level report covering all configurations for a given library */
export type BenchmarkReport = {
  libraryId: string
  configs: BenchmarkConfigReport[]
}

/**
 * Runs the full benchmark sweep.
 *
 * For each config, every benchmark case is executed through the injected search
 * function. Results are collected per case id and fed into the existing
 * `evaluateAll` helper to produce aggregate metrics. Per-case result lists are
 * preserved in the report so callers can inspect individual rankings later
 * (e.g. to check where a specific Britney chunk landed).
 *
 * This function is pure with respect to the search pipeline — it makes no
 * assumptions about how results are produced, only that the injected function
 * honours the same signature as `search.service.ts`.
 */
export async function runBenchmark(
  searchFn: BenchmarkSearchFn,
  libraryId: string,
  cases: BenchmarkCase[],
  configs: BenchmarkConfig[],
): Promise<BenchmarkReport> {
  const configReports: BenchmarkConfigReport[] = []

  for (const config of configs) {
    const caseResults: BenchmarkCaseResult[] = []
    const resultsByCaseId = new Map<string, SearchResult[]>()

    for (const case_ of cases) {
      const results = await searchFn(
        case_.query,
        libraryId,
        config.maxResults,
        config.weights,
        config.minScore,
        config.minAbsoluteScore,
      )
      caseResults.push({ caseId: case_.id, results })
      resultsByCaseId.set(case_.id, results)
    }

    // k for evaluation is the maxResults of the config — metrics are computed
    // over the same window the search was asked to return
    const metrics: BenchmarkMetrics = evaluateAll(
      cases,
      resultsByCaseId,
      config.maxResults,
    )

    configReports.push({ config, metrics, caseResults })
  }

  return { libraryId, configs: configReports }
}
