import { describe, it, expect } from 'vitest'
import { applyQueryLexicalAbstention } from './search-benchmark.query-abstention'
import type { BenchmarkCase } from './search-benchmark.types'
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
  const resultsByCaseId = new Map<string, SearchResult[]>()
  for (const cr of caseResults) {
    resultsByCaseId.set(cr.caseId, cr.results)
  }
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

describe('search-benchmark.query-abstention — applyQueryLexicalAbstention', () => {
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
    const qaReport = applyQueryLexicalAbstention([posCase, negCase], report, 0)

    // All results preserved — every query has at least one result with coverage ≥ 0
    expect(qaReport.caseResults[0]!.results).toHaveLength(2)
    expect(qaReport.caseResults[1]!.results).toHaveLength(1)
    expect(qaReport.threshold).toBe(0)
  })

  it('threshold 0.5 removes all results only for queries with no qualifying evidence', () => {
    const caseResults = [
      {
        caseId: 'pos1',
        results: [
          // High coverage — qualifies
          result('c1', 'Britney Spears debut single Baby One More Time'),
          // Low coverage — would not qualify alone
          result('c2', 'unrelated content'),
        ],
      },
      {
        caseId: 'neg1',
        results: [
          // No tokens from "Britney Spears married to Justin Timberlake" present
          // (after stop-word removal: "britney", "spears", "married", "justin", "timberlake")
          result('c3', 'completely unrelated plants and flowers'),
          result('c4', 'another irrelevant result about cooking'),
        ],
      },
    ]
    const report = buildReport(caseResults)
    const qaReport = applyQueryLexicalAbstention([posCase, negCase], report, 0.5)

    // pos1: c1 qualifies → entire list preserved (including low-coverage c2)
    expect(qaReport.caseResults[0]!.results).toHaveLength(2)
    expect(qaReport.caseResults[0]!.results.map((r) => r.chunkId)).toEqual(['c1', 'c2'])

    // neg1: no result qualifies → entire list replaced with empty
    expect(qaReport.caseResults[1]!.results).toHaveLength(0)
  })

  it('preserves low-coverage results when another result qualifies', () => {
    const caseResults = [
      {
        caseId: 'pos1',
        results: [
          // Low coverage — 0 tokens from query
          result('c1', 'unrelated content about something else'),
          // Low coverage — 1 of 3 tokens ("britney")
          result('c2', 'Britney something unrelated'),
          // High coverage — all 3 tokens ("britney", "spears", "debut", "single")
          result('c3', 'Britney Spears debut single Baby One More Time'),
          // Low coverage — 0 tokens
          result('c4', 'completely different topic'),
        ],
      },
    ]
    const report = buildReport(caseResults)
    const qaReport = applyQueryLexicalAbstention([posCase], report, 0.5)

    // c3 qualifies → entire list preserved, including low-coverage c1, c2, c4
    expect(qaReport.caseResults[0]!.results).toHaveLength(4)
    expect(qaReport.caseResults[0]!.results.map((r) => r.chunkId)).toEqual([
      'c1', 'c2', 'c3', 'c4',
    ])
  })

  it('metrics and FPR update correctly when queries are silenced', () => {
    const caseResults = [
      {
        caseId: 'pos1',
        results: [
          // High coverage — qualifies, so pos1 results preserved
          result('c1', 'Britney Spears debut single Baby One More Time'),
        ],
      },
      {
        caseId: 'neg1',
        results: [
          // No qualifying coverage → neg1 silenced
          result('c2', 'plants and flowers gardening tips'),
          result('c3', 'cooking recipes for dinner'),
        ],
      },
    ]
    const report = buildReport(caseResults)

    // Baseline (threshold 0): neg1 has results → FPR = 1.0
    const baseline = applyQueryLexicalAbstention([posCase, negCase], report, 0)
    expect(baseline.metrics.falsePositiveRate).toBe(1.0)

    // Threshold 0.5: neg1 silenced → FPR = 0.0
    const filtered = applyQueryLexicalAbstention([posCase, negCase], report, 0.5)
    expect(filtered.metrics.falsePositiveRate).toBe(0.0)

    // Positive case preserved → hit@k should remain the same
    expect(filtered.caseResults[0]!.results).toHaveLength(1)
    expect(filtered.caseResults[0]!.results[0]!.chunkId).toBe('c1')
  })

  it('threshold 1.0 keeps results only when a result has full coverage', () => {
    const caseResults = [
      {
        caseId: 'pos1',
        results: [
          // All meaningful tokens present → coverage 1.0
          result('c1', 'Britney Spears debut single Baby One More Time'),
          // Partial coverage → 0.67 (2 of 3 tokens)
          result('c2', 'Britney Spears debut something'),
        ],
      },
      {
        caseId: 'neg1',
        results: [
          // Partial coverage → not 1.0
          result('c3', 'Britney Spears married someone'),
        ],
      },
    ]
    const report = buildReport(caseResults)
    const qaReport = applyQueryLexicalAbstention([posCase, negCase], report, 1.0)

    // pos1: c1 has coverage 1.0 → entire list preserved
    expect(qaReport.caseResults[0]!.results).toHaveLength(2)

    // neg1: max coverage is partial (< 1.0) → silenced
    expect(qaReport.caseResults[1]!.results).toHaveLength(0)
  })

  it('threshold 1.0 silences query when no result has full coverage', () => {
    const caseResults = [
      {
        caseId: 'pos1',
        results: [
          // Partial coverage only — 2 of 3 tokens
          result('c1', 'Britney Spears debut something'),
          result('c2', 'Britney debut single'),
        ],
      },
    ]
    const report = buildReport(caseResults)
    const qaReport = applyQueryLexicalAbstention([posCase], report, 1.0)

    // No result reaches 1.0 → entire list silenced
    expect(qaReport.caseResults[0]!.results).toHaveLength(0)
  })

  it('handles empty results gracefully', () => {
    const caseResults = [{ caseId: 'pos1', results: [] }]
    const report = buildReport(caseResults)
    const qaReport = applyQueryLexicalAbstention([posCase], report, 0.5)

    // No results → no qualifying result → silenced (empty stays empty)
    expect(qaReport.caseResults[0]!.results).toHaveLength(0)
  })

  it('handles missing case in cases list', () => {
    const caseResults = [
      {
        caseId: 'unknown-case',
        results: [result('c1', 'some text')],
      },
    ]
    const report = buildReport(caseResults)
    const qaReport = applyQueryLexicalAbstention([], report, 0.5)

    // Results should be preserved as-is when case is not found
    expect(qaReport.caseResults[0]!.results).toHaveLength(1)
  })

  it('preserves case ordering from original report', () => {
    const caseResults = [
      { caseId: 'pos1', results: [result('c1', 'Britney Spears debut single')] },
      { caseId: 'neg1', results: [result('c2', 'unrelated')] },
    ]
    const report = buildReport(caseResults)
    const qaReport = applyQueryLexicalAbstention([posCase, negCase], report, 0)

    expect(qaReport.caseResults[0]!.caseId).toBe('pos1')
    expect(qaReport.caseResults[1]!.caseId).toBe('neg1')
  })

  it('differs from per-result abstention: low-coverage results survive when another qualifies', () => {
    // This test documents the key difference from applyLexicalAbstention:
    // per-result filters out low-coverage results individually,
    // query-level keeps the entire list if ANY result qualifies.
    const caseResults = [
      {
        caseId: 'pos1',
        results: [
          result('c1', 'Britney Spears debut single Baby One More Time'), // high coverage
          result('c2', 'unrelated content'), // zero coverage
        ],
      },
    ]
    const report = buildReport(caseResults)
    const qaReport = applyQueryLexicalAbstention([posCase], report, 0.5)

    // Query-level: c1 qualifies → entire list preserved (c2 survives)
    expect(qaReport.caseResults[0]!.results).toHaveLength(2)
    expect(qaReport.caseResults[0]!.results.map((r) => r.chunkId)).toEqual(['c1', 'c2'])
  })
})
