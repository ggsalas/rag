import type { HybridWeights } from '@/types/search'

/**
 * Configuration for a single benchmark run.
 *
 * Each config is passed through to the injected search function as-is, so the
 * sweep can explore different weight presets, score thresholds, and result
 * limits without touching production search code.
 */
export type BenchmarkConfig = {
  /** Human-readable label (e.g. "text-only-min0") */
  name: string
  /** BM25 / semantic weight pair forwarded to the search function */
  weights: HybridWeights
  /** Maximum number of results to request from the search function */
  maxResults: number
  /** Relative score threshold (%) forwarded to the search function */
  minScore: number
  /**
   * Absolute score floor forwarded to the search function.
   * Results below this score are discarded regardless of relative thresholds.
   */
  minAbsoluteScore: number
}

/**
 * Weight presets spanning the full text↔vector spectrum.
 *
 * Shared between the full sweep and the quick subset so labels stay consistent.
 *
 * `semantic` uses { text: 0.1, vector: 0.9 } (the former production "semantic"
 * preset) so the sweep measures the exact configuration alongside neighbours.
 */
const WEIGHT_PRESETS: Array<{ label: string; weights: HybridWeights }> = [
  { label: 'text-only', weights: { text: 1, vector: 0 } },
  { label: 'text-heavy', weights: { text: 0.75, vector: 0.25 } },
  { label: 'balanced', weights: { text: 0.5, vector: 0.5 } },
  { label: 'vector-heavy', weights: { text: 0.25, vector: 0.75 } },
  { label: 'semantic', weights: { text: 0.1, vector: 0.9 } },
  { label: 'vector-only', weights: { text: 0, vector: 1 } },
]

/**
 * Default sweep of configurations for the second experiment.
 *
 * Relative thresholds (minScore) were already measured in the first sweep, so
 * this experiment fixes minScore=0 and explores the new absolute floor axis
 * together with candidate limits:
 *
 * - 6 weight presets (text-only → vector-only, including the production
 *   `semantic` weights { text: 0.1, vector: 0.9 })
 * - 3 maxResults values: 6, 10, 20
 * - 3 absolute floors: 0.3, 0.5, 0.7
 *
 * Total: 6 × 3 × 3 = 54 configs × 16 cases = 864 search calls.
 *
 * Exported so tests and the dev UI runner can import it directly — not
 * hardcoded into production search.
 */
export const DEFAULT_BENCHMARK_CONFIGS: BenchmarkConfig[] = (() => {
  const maxResultsValues = [6, 10, 20]
  const absoluteFloors = [0.3, 0.5, 0.7]

  const configs: BenchmarkConfig[] = []
  for (const { label, weights } of WEIGHT_PRESETS) {
    for (const maxResults of maxResultsValues) {
      for (const minAbsoluteScore of absoluteFloors) {
        configs.push({
          name: `${label}-k${maxResults}-abs${minAbsoluteScore}`,
          weights,
          maxResults,
          minScore: 0,
          minAbsoluteScore,
        })
      }
    }
  }
  return configs
})()

/**
 * Smaller subset for faster iteration during development.
 *
 * Picks 3 representative weight presets (text-heavy / balanced / vector-heavy)
 * crossed with maxResults ∈ {6, 20} and absolute floors ∈ {0.3, 0.5, 0.7}:
 *
 * Total: 3 × 2 × 3 = 18 configs × 16 cases = 288 search calls.
 *
 * Use this for quick feedback; switch to `DEFAULT_BENCHMARK_CONFIGS` for the
 * full sweep before drawing conclusions.
 */
export const QUICK_BENCHMARK_CONFIGS: BenchmarkConfig[] = (() => {
  const quickWeights = WEIGHT_PRESETS.filter((p) =>
    ['text-heavy', 'balanced', 'vector-heavy'].includes(p.label),
  )
  const maxResultsValues = [6, 20]
  const absoluteFloors = [0.3, 0.5, 0.7]

  const configs: BenchmarkConfig[] = []
  for (const { label, weights } of quickWeights) {
    for (const maxResults of maxResultsValues) {
      for (const minAbsoluteScore of absoluteFloors) {
        configs.push({
          name: `${label}-k${maxResults}-abs${minAbsoluteScore}`,
          weights,
          maxResults,
          minScore: 0,
          minAbsoluteScore,
        })
      }
    }
  }
  return configs
})()
