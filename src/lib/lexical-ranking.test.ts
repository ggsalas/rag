import { describe, it, expect } from 'vitest'
import {
  rankByLexicalRelevance,
  computeLexicalRelevanceScore,
  computeLexicalCoverage,
  RERANK_CANDIDATE_POOL,
} from './lexical-ranking'
import type { SearchResult } from '@/types/search'

/** Helper to build a minimal SearchResult for testing */
function makeResult(overrides: Partial<SearchResult> & { chunkId: string; score: number }): SearchResult {
  return {
    documentId: 'd-1',
    documentName: 'doc.txt',
    text: overrides.searchText ?? '',
    searchText: '',
    sectionPath: [],
    headingText: '',
    chunkIndex: 0,
    ...overrides,
  }
}

describe('lexical-ranking', () => {
  describe('RERANK_CANDIDATE_POOL', () => {
    // EXPERIMENT: bumped from 20 → 100 to widen the internal candidate pool
    // for benchmark evaluation. See lexical-ranking.ts for context.
    it('should be 100', () => {
      expect(RERANK_CANDIDATE_POOL).toBe(100)
    })
  })

  describe('exact phrase boost', () => {
    it('should boost a result that contains the exact query phrase', () => {
      const query = 'climate change impact'
      const withPhrase = makeResult({
        chunkId: 'c-1',
        score: 0.7,
        searchText: 'the climate change impact on agriculture is significant',
      })
      const withoutPhrase = makeResult({
        chunkId: 'c-2',
        score: 0.7,
        searchText: 'climate varies change over time with impact varying',
      })

      const scoreWith = computeLexicalRelevanceScore(query, withPhrase)
      const scoreWithout = computeLexicalRelevanceScore(query, withoutPhrase)

      // Both have full token coverage, but only c-1 has the exact phrase
      expect(scoreWith).toBeGreaterThan(scoreWithout)
    })

    it('should not give phrase bonus when query is not contiguous', () => {
      const query = 'neural networks'
      const candidate = makeResult({
        chunkId: 'c-1',
        score: 0.8,
        searchText: 'networks of neural origin',
      })

      const score = computeLexicalRelevanceScore(query, candidate)
      // Has both tokens but not as contiguous phrase → no phrase bonus
      // coverage = 2/2 = 1.0, phrase = 0, heading = 0
      // rerankScore = 0.8 * (1 + 0.15 * 1.0) = 0.8 * 1.15 = 0.92
      expect(score).toBeCloseTo(0.8 * 1.15, 5)
    })
  })

  describe('query-term coverage', () => {
    it('should give higher score when more query tokens are present', () => {
      const query = 'alpha beta gamma delta'
      const fullCoverage = makeResult({
        chunkId: 'c-1',
        score: 0.7,
        searchText: 'alpha beta gamma delta epsilon',
      })
      const partialCoverage = makeResult({
        chunkId: 'c-2',
        score: 0.7,
        searchText: 'alpha beta something else',
      })

      const scoreFull = computeLexicalRelevanceScore(query, fullCoverage)
      const scorePartial = computeLexicalRelevanceScore(query, partialCoverage)

      expect(scoreFull).toBeGreaterThan(scorePartial)
    })

    it('should ignore stop words when computing coverage', () => {
      const query = 'the alpha is beta'
      // Non-stop tokens: alpha, beta (2 tokens)
      const candidate = makeResult({
        chunkId: 'c-1',
        score: 0.7,
        searchText: 'alpha beta content',
      })

      const score = computeLexicalRelevanceScore(query, candidate)
      // coverage = 2/2 = 1.0 (both non-stop tokens found)
      // phrase = 0 ("the alpha is beta" not contiguous)
      // heading = 0
      expect(score).toBeCloseTo(0.7 * (1 + 0.15), 5)
    })

    it('should return original score when no query tokens match', () => {
      const query = 'alpha beta'
      const candidate = makeResult({
        chunkId: 'c-1',
        score: 0.7,
        searchText: 'completely unrelated content here',
      })

      const score = computeLexicalRelevanceScore(query, candidate)
      expect(score).toBeCloseTo(0.7, 5)
    })

    it('should handle query with only stop words gracefully', () => {
      const query = 'the is a'
      const candidate = makeResult({
        chunkId: 'c-1',
        score: 0.7,
        searchText: 'some text content',
      })

      const score = computeLexicalRelevanceScore(query, candidate)
      // No non-stop tokens → coverage = 0, phrase = 0, heading = 0
      expect(score).toBeCloseTo(0.7, 5)
    })
  })

  describe('heading/sectionPath boost', () => {
    it('should boost when query token appears in headingText', () => {
      const query = 'photosynthesis'
      const withHeading = makeResult({
        chunkId: 'c-1',
        score: 0.7,
        searchText: 'the process converts light to energy',
        headingText: 'Photosynthesis Overview',
      })
      const withoutHeading = makeResult({
        chunkId: 'c-2',
        score: 0.7,
        searchText: 'the process converts light to energy',
        headingText: '',
      })

      const scoreWith = computeLexicalRelevanceScore(query, withHeading)
      const scoreWithout = computeLexicalRelevanceScore(query, withoutHeading)

      expect(scoreWith).toBeGreaterThan(scoreWithout)
    })

    it('should boost when query token appears in sectionPath', () => {
      const query = 'mitochondria'
      const withSection = makeResult({
        chunkId: 'c-1',
        score: 0.7,
        searchText: 'the organelle produces ATP',
        sectionPath: ['Biology', 'Cell Structure', 'Mitochondria'],
      })
      const withoutSection = makeResult({
        chunkId: 'c-2',
        score: 0.7,
        searchText: 'the organelle produces ATP',
        sectionPath: [],
      })

      const scoreWith = computeLexicalRelevanceScore(query, withSection)
      const scoreWithout = computeLexicalRelevanceScore(query, withoutSection)

      expect(scoreWith).toBeGreaterThan(scoreWithout)
    })

    it('should be case-insensitive for heading match', () => {
      const query = 'DNA Replication'
      const candidate = makeResult({
        chunkId: 'c-1',
        score: 0.7,
        searchText: 'some text',
        headingText: 'dna replication process',
      })

      const score = computeLexicalRelevanceScore(query, candidate)
      // headingHit = 1 (both tokens found in heading)
      // coverage = 0 (tokens not in searchText)
      // phrase = 0
      expect(score).toBeCloseTo(0.7 * (1 + 0.10), 5)
    })
  })

  describe('deterministic ordering', () => {
    it('should produce stable ordering for identical scores', () => {
      const query = 'test'
      const candidates: SearchResult[] = [
        makeResult({ chunkId: 'c-b', score: 0.7, searchText: 'test content' }),
        makeResult({ chunkId: 'c-a', score: 0.7, searchText: 'test content' }),
        makeResult({ chunkId: 'c-c', score: 0.7, searchText: 'test content' }),
      ]

      const result1 = rankByLexicalRelevance(query, candidates)
      const result2 = rankByLexicalRelevance(query, candidates)

      // Same input → same output
      expect(result1.map((r) => r.chunkId)).toEqual(result2.map((r) => r.chunkId))
      // Tie-broken by chunkId lexicographic order
      expect(result1.map((r) => r.chunkId)).toEqual(['c-a', 'c-b', 'c-c'])
    })

    it('should sort by rerankScore descending', () => {
      const query = 'alpha beta'
      // Scores close enough that the rerank boost changes the Orama ordering
      const candidates: SearchResult[] = [
        makeResult({ chunkId: 'c-1', score: 0.70, searchText: 'alpha beta gamma' }),
        makeResult({ chunkId: 'c-2', score: 0.72, searchText: 'nothing related' }),
        makeResult({ chunkId: 'c-3', score: 0.71, searchText: 'alpha beta content' }),
      ]

      const results = rankByLexicalRelevance(query, candidates)

      // c-3: 0.71 * (1 + 0.15 + 0.20) = 0.9585 (full coverage + phrase)
      // c-1: 0.70 * (1 + 0.15 + 0.20) = 0.9450 (full coverage + phrase)
      // c-2: 0.72 * 1.0 = 0.7200 (no coverage)
      expect(results[0]!.chunkId).toBe('c-3')
      expect(results[1]!.chunkId).toBe('c-1')
      expect(results[2]!.chunkId).toBe('c-2')
    })
  })

  describe('max result truncation', () => {
    it('should return all results when called directly (no truncation in rerank)', () => {
      const query = 'test'
      const candidates: SearchResult[] = Array.from({ length: 25 }, (_, i) =>
        makeResult({ chunkId: `c-${i}`, score: 0.5 + i * 0.01, searchText: 'test content' }),
      )

      const results = rankByLexicalRelevance(query, candidates)
      expect(results).toHaveLength(25)
    })

    it('should return empty array for empty candidates', () => {
      expect(rankByLexicalRelevance('query', [])).toEqual([])
    })
  })

  describe('existing score-floor behavior (preserved)', () => {
    it('should not alter the original score field', () => {
      const query = 'alpha'
      const candidates: SearchResult[] = [
        makeResult({ chunkId: 'c-1', score: 0.42, searchText: 'alpha content' }),
      ]

      const results = rankByLexicalRelevance(query, candidates)
      expect(results[0]!.score).toBe(0.42) // original preserved
      expect(results[0]!.rerankScore).toBeGreaterThan(0.42) // boosted
    })

    it('should keep original score dominant — boost never exceeds 45%', () => {
      const query = 'alpha beta'
      // Maximum possible boost: coverage=1 + phrase=1 + heading=1
      const candidate = makeResult({
        chunkId: 'c-1',
        score: 0.5,
        searchText: 'alpha beta',
        headingText: 'Alpha Beta Section',
      })

      const score = computeLexicalRelevanceScore(query, candidate)
      // Max boost: 0.5 * (1 + 0.15 + 0.20 + 0.10) = 0.5 * 1.45 = 0.725
      expect(score).toBeCloseTo(0.725, 5)
      // Original score (0.5) is still the dominant factor
      expect(score).toBeLessThan(0.5 * 1.5)
    })
  })

  describe('computeLexicalCoverage', () => {
    it('should return 0 when no query tokens appear in searchText', () => {
      expect(computeLexicalCoverage('alpha beta', 'completely unrelated text')).toBe(0)
    })

    it('should return 1 when all meaningful query tokens appear in searchText', () => {
      expect(computeLexicalCoverage('alpha beta', 'alpha beta gamma delta')).toBe(1)
    })

    it('should return a fraction for partial coverage', () => {
      // 2 of 4 meaningful tokens found
      expect(computeLexicalCoverage('alpha beta gamma delta', 'alpha beta something')).toBe(0.5)
    })

    it('should return 0 when query contains only stop words', () => {
      // No meaningful tokens → coverage is 0 (not NaN or Infinity)
      expect(computeLexicalCoverage('the is a', 'some random text')).toBe(0)
      expect(computeLexicalCoverage('the is a', 'the is a')).toBe(0)
    })

    it('should be case-insensitive', () => {
      expect(computeLexicalCoverage('Alpha BETA', 'alpha beta content')).toBe(1)
    })

    it('should match substrings within words (token appears inside a larger word)', () => {
      // "alpha" is a substring of "alphabetical" — coverage still counts it
      expect(computeLexicalCoverage('alpha', 'alphabetical content')).toBe(1)
    })

    it('should return 0 for empty query', () => {
      expect(computeLexicalCoverage('', 'some text')).toBe(0)
    })

    it('should integrate with rerank formula consistently', () => {
      const query = 'alpha beta gamma'
      const candidate = makeResult({
        chunkId: 'c-1',
        score: 0.8,
        searchText: 'alpha beta some other content',
      })

      const coverage = computeLexicalCoverage(query, candidate.searchText)
      // 2 of 3 meaningful tokens found → coverage = 2/3
      expect(coverage).toBeCloseTo(2 / 3, 5)

      // The rerank score should use the same coverage value
      const rerankScore = computeLexicalRelevanceScore(query, candidate)
      // coverage = 2/3, phrase = 0, heading = 0
      const expected = 0.8 * (1 + 0.15 * (2 / 3))
      expect(rerankScore).toBeCloseTo(expected, 5)
    })
  })
})
