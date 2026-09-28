import { describe, it, expect, vi } from 'vitest'
import { runBenchmark } from './search-benchmark.runner'
import type { BenchmarkSearchFn } from './search-benchmark.runner'
import type { BenchmarkConfig } from './search-benchmark.config'
import {
  DEFAULT_BENCHMARK_CONFIGS,
  QUICK_BENCHMARK_CONFIGS,
} from './search-benchmark.config'
import type { BenchmarkCase } from './search-benchmark.types'
import type { SearchResult } from '@/types/search'

/** Minimal SearchResult stub — only the fields evaluation helpers read */
function result(
  chunkId: string,
  text: string,
  score = 1,
): SearchResult {
  return {
    chunkId,
    documentId: 'doc-1',
    documentName: 'doc.pdf',
    text,
    searchText: text,
    sectionPath: [],
    headingText: '',
    score,
    chunkIndex: 0,
  }
}

const POS_CASE: BenchmarkCase = {
  id: 'debut-single',
  query: "What was Britney Spears' debut single?",
  requiredAnchors: ['Baby One More Time'],
  supportingAnchors: ['1998'],
  kind: 'positive',
}

const NEG_CASE: BenchmarkCase = {
  id: 'neg-capital',
  query: 'What is the capital of France?',
  requiredAnchors: [],
  supportingAnchors: [],
  kind: 'negative',
}

const CASES: BenchmarkCase[] = [POS_CASE, NEG_CASE]

const SIMPLE_CONFIG: BenchmarkConfig = {
  name: 'test-config',
  weights: { text: 0.5, vector: 0.5 },
  maxResults: 6,
  minScore: 75,
  minAbsoluteScore: 0.5,
}

describe('search-benchmark.runner — config forwarding', () => {
  it('forwards maxResults, weights, minScore, and minAbsoluteScore to the search function', async () => {
    const searchFn = vi.fn<BenchmarkSearchFn>().mockResolvedValue([])

    await runBenchmark(searchFn, 'lib-1', CASES, [SIMPLE_CONFIG])

    // Called once per case
    expect(searchFn).toHaveBeenCalledTimes(2)

    // First call: positive case
    expect(searchFn.mock.calls[0]).toEqual([
      POS_CASE.query,
      'lib-1',
      SIMPLE_CONFIG.maxResults,
      SIMPLE_CONFIG.weights,
      SIMPLE_CONFIG.minScore,
      SIMPLE_CONFIG.minAbsoluteScore,
    ])

    // Second call: negative case
    expect(searchFn.mock.calls[1]).toEqual([
      NEG_CASE.query,
      'lib-1',
      SIMPLE_CONFIG.maxResults,
      SIMPLE_CONFIG.weights,
      SIMPLE_CONFIG.minScore,
      SIMPLE_CONFIG.minAbsoluteScore,
    ])
  })

  it('uses the libraryId passed to runBenchmark', async () => {
    const searchFn = vi.fn<BenchmarkSearchFn>().mockResolvedValue([])
    await runBenchmark(searchFn, 'my-library', [POS_CASE], [SIMPLE_CONFIG])
    expect(searchFn.mock.calls[0]![1]).toBe('my-library')
  })

  it('forwards a custom absolute floor to the search function', async () => {
    const searchFn = vi.fn<BenchmarkSearchFn>().mockResolvedValue([])
    const customConfig: BenchmarkConfig = {
      ...SIMPLE_CONFIG,
      name: 'custom-abs',
      minAbsoluteScore: 0.3,
    }

    await runBenchmark(searchFn, 'lib-1', [POS_CASE], [customConfig])

    expect(searchFn.mock.calls[0]).toEqual([
      POS_CASE.query,
      'lib-1',
      customConfig.maxResults,
      customConfig.weights,
      customConfig.minScore,
      0.3,
    ])
  })
})

describe('search-benchmark.runner — runs all cases', () => {
  it('executes every case for every config', async () => {
    const searchFn = vi.fn<BenchmarkSearchFn>().mockResolvedValue([])
    const configA: BenchmarkConfig = { ...SIMPLE_CONFIG, name: 'a' }
    const configB: BenchmarkConfig = { ...SIMPLE_CONFIG, name: 'b' }

    const report = await runBenchmark(searchFn, 'lib-1', CASES, [
      configA,
      configB,
    ])

    // 2 cases × 2 configs = 4 calls
    expect(searchFn).toHaveBeenCalledTimes(4)
    expect(report.configs).toHaveLength(2)
    expect(report.configs[0]!.config.name).toBe('a')
    expect(report.configs[1]!.config.name).toBe('b')
  })

  it('returns empty results when search returns nothing', async () => {
    const searchFn = vi.fn<BenchmarkSearchFn>().mockResolvedValue([])
    const report = await runBenchmark(searchFn, 'lib-1', CASES, [SIMPLE_CONFIG])

    const caseResults = report.configs[0]!.caseResults
    expect(caseResults).toHaveLength(2)
    expect(caseResults[0]!.caseId).toBe('debut-single')
    expect(caseResults[0]!.results).toEqual([])
    expect(caseResults[1]!.caseId).toBe('neg-capital')
    expect(caseResults[1]!.results).toEqual([])
  })
})

describe('search-benchmark.runner — metric aggregation', () => {
  it('produces correct metrics for a hit on the positive case and empty on negative', async () => {
    const hitResult = result(
      'c1',
      '...Baby One More Time was released in 1998.',
    )

    const searchFn = vi.fn<BenchmarkSearchFn>().mockImplementation(
      async (query: string) => {
        if (query === POS_CASE.query) return [hitResult]
        return [] // negative case → no results → no false positive
      },
    )

    const report = await runBenchmark(searchFn, 'lib-1', CASES, [SIMPLE_CONFIG])
    const { metrics } = report.configs[0]!

    // 1 positive case, hit at rank 1 → hit@k=1, recall@k=1, precision@k=1/6, mrr=1
    expect(metrics.hitAtK).toBe(1)
    expect(metrics.recallAtK).toBe(1)
    expect(metrics.precisionAtK).toBeCloseTo(1 / 6)
    expect(metrics.mrr).toBe(1)
    // 1 negative case, empty results → FP rate = 0
    expect(metrics.falsePositiveRate).toBe(0)
    expect(metrics.k).toBe(SIMPLE_CONFIG.maxResults)
  })

  it('detects false positives when a negative case returns results', async () => {
    const searchFn = vi.fn<BenchmarkSearchFn>().mockImplementation(
      async (query: string) => {
        if (query === NEG_CASE.query) return [result('x', 'Paris is nice')]
        return [] // positive case returns nothing → miss
      },
    )

    const report = await runBenchmark(searchFn, 'lib-1', CASES, [SIMPLE_CONFIG])
    const { metrics } = report.configs[0]!

    expect(metrics.hitAtK).toBe(0)
    expect(metrics.falsePositiveRate).toBe(1)
  })

  it('aggregates across multiple configs independently', async () => {
    const configA: BenchmarkConfig = { ...SIMPLE_CONFIG, name: 'a', minScore: 0 }
    const configB: BenchmarkConfig = { ...SIMPLE_CONFIG, name: 'b', minScore: 99 }

    const searchFn = vi.fn<BenchmarkSearchFn>().mockImplementation(
      async (query: string, _lib, _max, _w, minScore) => {
        // configA (minScore=0): return hit for positive, nothing for negative
        // configB (minScore=99): return nothing for everything
        if (minScore === 0 && query === POS_CASE.query) {
          return [result('c1', '...Baby One More Time 1998')]
        }
        return []
      },
    )

    const report = await runBenchmark(searchFn, 'lib-1', CASES, [
      configA,
      configB,
    ])

    expect(report.configs[0]!.metrics.hitAtK).toBe(1)
    expect(report.configs[1]!.metrics.hitAtK).toBe(0)
  })
})

describe('search-benchmark.runner — per-case results preserved', () => {
  it('preserves the full result list for each case', async () => {
    const r1 = result('c1', '...Baby One More Time 1998', 0.9)
    const r2 = result('c2', 'Another chunk about 1998', 0.5)

    const searchFn = vi.fn<BenchmarkSearchFn>().mockImplementation(
      async (query: string) => {
        if (query === POS_CASE.query) return [r1, r2]
        return []
      },
    )

    const report = await runBenchmark(searchFn, 'lib-1', CASES, [SIMPLE_CONFIG])
    const caseResults = report.configs[0]!.caseResults

    const posResult = caseResults.find((c) => c.caseId === 'debut-single')
    expect(posResult).toBeDefined()
    expect(posResult!.results).toHaveLength(2)
    expect(posResult!.results[0]!.chunkId).toBe('c1')
    expect(posResult!.results[1]!.chunkId).toBe('c2')

    const negResult = caseResults.find((c) => c.caseId === 'neg-capital')
    expect(negResult).toBeDefined()
    expect(negResult!.results).toEqual([])
  })

  it('allows inspecting individual rankings (e.g. Britney chunk position)', async () => {
    // Simulate a scenario where the desired chunk is at position 3
    const miss1 = result('m1', 'unrelated content', 0.9)
    const miss2 = result('m2', 'also unrelated', 0.8)
    const hit = result('h1', '...Baby One More Time was released in 1998', 0.7)

    const searchFn = vi.fn<BenchmarkSearchFn>().mockResolvedValue([
      miss1,
      miss2,
      hit,
    ])

    const report = await runBenchmark(searchFn, 'lib-1', [POS_CASE], [
      SIMPLE_CONFIG,
    ])

    const results = report.configs[0]!.caseResults[0]!.results
    // The hit is at index 2 (third position) — caller can inspect this
    expect(results[2]!.chunkId).toBe('h1')
    expect(results[2]!.text).toContain('...Baby One More Time')
  })
})

describe('search-benchmark.runner — report shape', () => {
  it('includes libraryId in the top-level report', async () => {
    const searchFn = vi.fn<BenchmarkSearchFn>().mockResolvedValue([])
    const report = await runBenchmark(searchFn, 'lib-xyz', CASES, [
      SIMPLE_CONFIG,
    ])
    expect(report.libraryId).toBe('lib-xyz')
  })

  it('each config report contains config, metrics, and caseResults', async () => {
    const searchFn = vi.fn<BenchmarkSearchFn>().mockResolvedValue([])
    const report = await runBenchmark(searchFn, 'lib-1', CASES, [SIMPLE_CONFIG])
    const cr = report.configs[0]!
    expect(cr.config).toBe(SIMPLE_CONFIG)
    expect(cr.metrics).toBeDefined()
    expect(cr.metrics.k).toBe(SIMPLE_CONFIG.maxResults)
    expect(Array.isArray(cr.caseResults)).toBe(true)
  })
})

describe('search-benchmark.config — DEFAULT_BENCHMARK_CONFIGS', () => {
  it('has 54 configs (6 weight presets × 3 maxResults × 3 absolute floors)', () => {
    expect(DEFAULT_BENCHMARK_CONFIGS).toHaveLength(54)
  })

  it('covers the full weight spectrum', () => {
    const weightPairs = DEFAULT_BENCHMARK_CONFIGS.map(
      (c) => `${c.weights.text}/${c.weights.vector}`,
    )
    const unique = new Set(weightPairs)
    expect(unique.size).toBe(6)
    expect(unique).toContain('1/0')
    expect(unique).toContain('0.75/0.25')
    expect(unique).toContain('0.5/0.5')
    expect(unique).toContain('0.25/0.75')
    expect(unique).toContain('0.1/0.9')
    expect(unique).toContain('0/1')
  })

  it('covers maxResults values 6, 10, 20', () => {
    const maxResults = new Set(
      DEFAULT_BENCHMARK_CONFIGS.map((c) => c.maxResults),
    )
    expect(maxResults).toEqual(new Set([6, 10, 20]))
  })

  it('covers absolute floors 0.3, 0.5, 0.7', () => {
    const floors = new Set(
      DEFAULT_BENCHMARK_CONFIGS.map((c) => c.minAbsoluteScore),
    )
    expect(floors).toEqual(new Set([0.3, 0.5, 0.7]))
  })

  it('all configs use minScore = 0 (relative threshold already measured)', () => {
    for (const c of DEFAULT_BENCHMARK_CONFIGS) {
      expect(c.minScore).toBe(0)
    }
  })

  it('all config names are unique', () => {
    const names = DEFAULT_BENCHMARK_CONFIGS.map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('search-benchmark.config — QUICK_BENCHMARK_CONFIGS', () => {
  it('has 18 configs (3 weight presets × 2 maxResults × 3 absolute floors)', () => {
    expect(QUICK_BENCHMARK_CONFIGS).toHaveLength(18)
  })

  it('uses only text-heavy, balanced, and vector-heavy weight presets', () => {
    const labels = new Set(
      QUICK_BENCHMARK_CONFIGS.map((c) =>
        c.weights.text === 0.75
          ? 'text-heavy'
          : c.weights.text === 0.5
            ? 'balanced'
            : 'vector-heavy',
      ),
    )
    expect(labels).toEqual(new Set(['text-heavy', 'balanced', 'vector-heavy']))
  })

  it('covers maxResults values 6 and 20', () => {
    const maxResults = new Set(
      QUICK_BENCHMARK_CONFIGS.map((c) => c.maxResults),
    )
    expect(maxResults).toEqual(new Set([6, 20]))
  })

  it('all config names are unique', () => {
    const names = QUICK_BENCHMARK_CONFIGS.map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
  })
})
