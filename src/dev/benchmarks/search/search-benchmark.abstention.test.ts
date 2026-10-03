import { describe, it, expect } from 'vitest'
import { applyLexicalAbstention } from './search-benchmark.abstention'
import type { BenchmarkCase, BenchmarkChunk } from './search-benchmark.types'
import type { BenchmarkConfigReport } from './search-benchmark.runner'
import type { BenchmarkConfig } from './search-benchmark.config'
import type { SearchResult } from '@/types/search'
import { evaluateAll } from './search-benchmark.evaluation'

/** Helper: build a SearchResult with given searchText */
function result(chunkId: string, searchText: string, score = 0.5): SearchResult {
  return {
    chunkId,
    documentId: 'doc1',
    documentName: 'doc1',
    text: searchText,
    searchText,
    sectionPath: [],
    headingText: '',
    score,
    chunkIndex: 0,
  }
}

/** Helper: build a BenchmarkConfigReport */
function buildReport(
  caseResults: Array<{ caseId: string; results: SearchResult[] }>,
  k = 5,
): BenchmarkConfigReport {
  const config: BenchmarkConfig = {
    name: 'test-config',
    weights: { text: 0.5, vector: 0.5 },
    maxResults: k,
    minScore: 0,
    minAbsoluteScore: 0,
  }
  // Compute metrics from the caseResults
  const resultsByCaseId = new Map<string, BenchmarkChunk[]>()
  for (const cr of caseResults) {
    resultsByCaseId.set(
      cr.caseId,
      cr.results.map((r) => ({ chunkId: r.chunkId, text: r.text, searchText: r.searchText })),
    )
  }
  // Use evaluateAll to compute metrics
  const cases: BenchmarkCase[] = caseResults.map((cr) => ({
    id: cr.caseId,
    query: 'test query',
    requiredAnchors: [],
    supportingAnchors: [],
    kind: 'positive' as const,
  }))
  const metrics = evaluateAll(cases, resultsByCaseId, k)

  return {
    config,
    metrics,
    caseResults,
  }
}

describe('search-benchmark.abstention — applyLexicalAbstention', () => {
  const posCase: BenchmarkCase = {
    id: 'pos1',
    query: 'Britney Spears debut single',
    requiredAnchors: ['Baby One More Time'],
    supportingAnchors: [],
    kind: 'positive',
  }

  const negCase: BenchmarkCase = {
    id: 'neg1',
    query: 'Britney Spears married to Justin Timberlake',
    requiredAnchors: [],
    supportingAnchors: [],
    kind: 'negative',
  }

  it('threshold 0 preserves all results (baseline)', () => {
    const caseResults = [
      {
        caseId: 'pos1',
        results: [
          result('c1', 'Britney Spears debut single Baby One More Time'),
          result('c2', 'unrelated content'),
        ],
      },
      {
        caseId: 'neg1',
        results: [result('c3', 'some negative result')],
      },
    ]
    const report = buildReport(caseResults)
    const abstentionReport = applyLexicalAbstention([posCase, negCase], report, 0)

    // All results should be preserved
    expect(abstentionReport.caseResults[0]!.results).toHaveLength(2)
    expect(abstentionReport.caseResults[1]!.results).toHaveLength(1)
    expect(abstentionReport.threshold).toBe(0)
  })

  it('threshold 0.5 removes zero-coverage results', () => {
    const caseResults = [
      {
        caseId: 'pos1',
        results: [
          // "Britney Spears debut single" — all 3 tokens present → coverage 1.0
          result('c1', 'Britney Spears debut single Baby One More Time'),
          // "unrelated content" — 0 tokens present → coverage 0.0
          result('c2', 'unrelated content'),
          // "Britney debut" — 2 of 3 tokens → coverage 0.67
          result('c3', 'Britney debut something'),
        ],
      },
    ]
    const report = buildReport(caseResults)
    const abstentionReport = applyLexicalAbstention([posCase], report, 0.5)

    // c1 (coverage 1.0) and c3 (coverage 0.67) should remain; c2 (coverage 0.0) removed
    expect(abstentionReport.caseResults[0]!.results).toHaveLength(2)
    expect(abstentionReport.caseResults[0]!.results.map((r) => r.chunkId)).toEqual(['c1', 'c3'])
  })

  it('threshold 1.0 keeps only full-coverage results', () => {
    const caseResults = [
      {
        caseId: 'pos1',
        results: [
          // All 3 tokens present → coverage 1.0
          result('c1', 'Britney Spears debut single Baby One More Time'),
          // 2 of 3 tokens → coverage 0.67
          result('c2', 'Britney debut something'),
          // 0 of 3 tokens → coverage 0.0
          result('c3', 'unrelated content'),
        ],
      },
    ]
    const report = buildReport(caseResults)
    const abstentionReport = applyLexicalAbstention([posCase], report, 1.0)

    // Only c1 (coverage 1.0) should remain
    expect(abstentionReport.caseResults[0]!.results).toHaveLength(1)
    expect(abstentionReport.caseResults[0]!.results[0]!.chunkId).toBe('c1')
  })

  it('metrics change when results are filtered', () => {
    const caseResults = [
      {
        caseId: 'pos1',
        results: [
          // Low coverage — will be filtered at 0.5
          result('c1', 'unrelated content about something else'),
          // High coverage — will remain
          result('c2', 'Britney Spears debut single Baby One More Time'),
        ],
      },
    ]
    const report = buildReport(caseResults)

    // Baseline (threshold 0): both results present
    const baseline = applyLexicalAbstention([posCase], report, 0)
    expect(baseline.caseResults[0]!.results).toHaveLength(2)

    // Threshold 0.5: only high-coverage result remains
    const filtered = applyLexicalAbstention([posCase], report, 0.5)
    expect(filtered.caseResults[0]!.results).toHaveLength(1)
    expect(filtered.caseResults[0]!.results[0]!.chunkId).toBe('c2')

    // Metrics should differ (filtered has fewer results, potentially better precision)
    expect(filtered.metrics).not.toEqual(baseline.metrics)
  })

  it('FPR decreases when negative case results are filtered', () => {
    const caseResults = [
      {
        caseId: 'neg1',
        results: [
          // Low coverage — will be filtered at 0.5
          result('c1', 'unrelated content about plants'),
          result('c2', 'another unrelated result'),
        ],
      },
    ]
    const report = buildReport(caseResults)

    // Baseline: negative case has results → FPR = 1.0
    const baseline = applyLexicalAbstention([negCase], report, 0)
    expect(baseline.metrics.falsePositiveRate).toBe(1.0)

    // Threshold 0.5: all results filtered → FPR = 0.0
    const filtered = applyLexicalAbstention([negCase], report, 0.5)
    expect(filtered.caseResults[0]!.results).toHaveLength(0)
    expect(filtered.metrics.falsePositiveRate).toBe(0.0)
  })

  it('handles empty results gracefully', () => {
    const caseResults = [{ caseId: 'pos1', results: [] }]
    const report = buildReport(caseResults)
    const abstentionReport = applyLexicalAbstention([posCase], report, 0.5)

    expect(abstentionReport.caseResults[0]!.results).toHaveLength(0)
  })

  it('handles missing case in cases list', () => {
    const caseResults = [
      {
        caseId: 'unknown-case',
        results: [result('c1', 'some text')],
      },
    ]
    const report = buildReport(caseResults)
    // Pass empty cases list — case not found
    const abstentionReport = applyLexicalAbstention([], report, 0.5)

    // Results should be preserved as-is when case is not found
    expect(abstentionReport.caseResults[0]!.results).toHaveLength(1)
  })

  it('preserves case ordering from original report', () => {
    const caseResults = [
      { caseId: 'pos1', results: [result('c1', 'Britney Spears debut single')] },
      { caseId: 'neg1', results: [result('c2', 'unrelated')] },
    ]
    const report = buildReport(caseResults)
    const abstentionReport = applyLexicalAbstention([posCase, negCase], report, 0)

    expect(abstentionReport.caseResults[0]!.caseId).toBe('pos1')
    expect(abstentionReport.caseResults[1]!.caseId).toBe('neg1')
  })
})
