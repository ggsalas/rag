import { describe, it, expect } from 'vitest'
import {
  anchorMatch,
  matchedRequiredAnchors,
  matchedSupportingAnchors,
  matchedAnchors,
  isHit,
  hitAtK,
  recallAtK,
  precisionAtK,
  reciprocalRank,
  falsePositiveRate,
  evaluateAll,
} from './search-benchmark.evaluation'
import type { BenchmarkCase, BenchmarkChunk } from './search-benchmark.types'

/** Helper: build a chunk with a single text body */
function chunk(id: string, text: string): BenchmarkChunk {
  return { chunkId: id, text, searchText: text }
}

/** Helper: build a positive case with required + supporting anchors */
function posCase(
  id: string,
  requiredAnchors: string[],
  supportingAnchors: string[] = [],
): BenchmarkCase {
  return { id, query: 'q', requiredAnchors, supportingAnchors, kind: 'positive' }
}

/** Helper: build a negative case */
function negCase(id: string): BenchmarkCase {
  return { id, query: 'q', requiredAnchors: [], supportingAnchors: [], kind: 'negative' }
}

describe('search-benchmark.evaluation — anchor matching', () => {
  const debutChunk = chunk(
    'c1',
    'Baby One More Time was released in 1998 as her debut single.',
  )

  it('anchorMatch is case-insensitive', () => {
    expect(anchorMatch(debutChunk, 'baby one more time')).toBe(true)
    expect(anchorMatch(debutChunk, 'BABY ONE MORE TIME')).toBe(true)
  })

  it('anchorMatch returns false when anchor is absent', () => {
    expect(anchorMatch(debutChunk, 'Toxic')).toBe(false)
  })

  it('anchorMatch returns false for empty anchor', () => {
    expect(anchorMatch(debutChunk, '')).toBe(false)
  })

  it('anchorMatch checks both text and searchText', () => {
    const c: BenchmarkChunk = {
      chunkId: 'x',
      text: 'display text',
      searchText: 'retrieval text with Toxic inside',
    }
    expect(anchorMatch(c, 'display')).toBe(true)
    expect(anchorMatch(c, 'Toxic')).toBe(true)
    expect(anchorMatch(c, 'missing')).toBe(false)
  })

  it('anchorMatch collapses whitespace runs (newlines, tabs) in chunk text', () => {
    // PDF layout artifact: name split across lines
    const splitChunk = chunk(
      'c-split',
      'Britney’s sons are Sean\nPreston and Jayden\tJames.',
    )
    expect(anchorMatch(splitChunk, 'Sean Preston')).toBe(true)
    expect(anchorMatch(splitChunk, 'Jayden James')).toBe(true)
  })

  it('anchorMatch collapses whitespace runs in the anchor itself', () => {
    const normalChunk = chunk('c-normal', 'Sean Preston Federline was born in 2005.')
    // Anchor with extra whitespace (e.g. copied from a formatted source)
    expect(anchorMatch(normalChunk, 'Sean  Preston')).toBe(true)
    expect(anchorMatch(normalChunk, 'Sean\nPreston')).toBe(true)
    expect(anchorMatch(normalChunk, 'Sean\t\tPreston')).toBe(true)
  })

  it('anchorMatch handles Unicode normalization (NFC)', () => {
    // é as combining accent (NFD) vs precomposed (NFC)
    const nfdChunk = chunk('c-nfd', 'Beyonc\u0065\u0301 performed live.')
    expect(anchorMatch(nfdChunk, 'Beyoncé')).toBe(true)
  })

  it('anchorMatch still returns false when anchor is absent after normalization', () => {
    const chunk_ = chunk('c', 'Just some random text.')
    expect(anchorMatch(chunk_, 'Sean Preston')).toBe(false)
  })

  it('anchorMatch returns false for whitespace-only anchor', () => {
    const chunk_ = chunk('c', 'Some text here.')
    expect(anchorMatch(chunk_, '   ')).toBe(false)
    expect(anchorMatch(chunk_, '\n\t')).toBe(false)
  })

  it('matchedRequiredAnchors returns only required anchors found', () => {
    const case_ = posCase(
      'debut-single',
      ['Baby One More Time', 'debut'],
      ['1998', 'Toxic'],
    )
    expect(matchedRequiredAnchors(debutChunk, case_).sort()).toEqual([
      'Baby One More Time',
      'debut',
    ])
  })

  it('matchedSupportingAnchors returns only supporting anchors found', () => {
    const case_ = posCase(
      'debut-single',
      ['Baby One More Time'],
      ['1998', 'Toxic'],
    )
    expect(matchedSupportingAnchors(debutChunk, case_)).toEqual(['1998'])
  })

  it('matchedAnchors returns all matched anchors (required + supporting)', () => {
    const case_ = posCase(
      'debut-single',
      ['Baby One More Time'],
      ['1998', 'Toxic'],
    )
    expect(matchedAnchors(debutChunk, case_).sort()).toEqual([
      '1998',
      'Baby One More Time',
    ])
  })
})

describe('search-benchmark.evaluation — isHit (required-anchors AND logic)', () => {
  const debutChunk = chunk(
    'c1',
    'Baby One More Time was released in 1998 as her debut single.',
  )

  it('isHit is true when ALL required anchors match', () => {
    const case_ = posCase('x', ['Baby One More Time', '1998'])
    expect(isHit(debutChunk, case_)).toBe(true)
  })

  it('isHit is false when only some required anchors match', () => {
    const case_ = posCase('x', ['Baby One More Time', 'Toxic'])
    expect(isHit(debutChunk, case_)).toBe(false)
  })

  it('isHit is false when only supporting anchors match (key behavior change)', () => {
    // Chunk has "1998" but NOT "Baby One More Time"
    const yearOnlyChunk = chunk('c2', 'Britney released a single in 1998.')
    const case_ = posCase('debut-single', ['Baby One More Time'], ['1998'])
    expect(isHit(yearOnlyChunk, case_)).toBe(false)
  })

  it('isHit is false when no required anchors match', () => {
    const case_ = posCase('x', ['Toxic', 'Circus'])
    expect(isHit(debutChunk, case_)).toBe(false)
  })

  it('isHit is false for negative cases (no required anchors)', () => {
    const case_ = negCase('n')
    expect(isHit(debutChunk, case_)).toBe(false)
  })

  it('isHit works with single required anchor', () => {
    const case_ = posCase('x', ['Baby One More Time'])
    expect(isHit(debutChunk, case_)).toBe(true)
  })
})

describe('search-benchmark.evaluation — hit@k, recall@k, precision@k, MRR', () => {
  const hit1 = chunk('h1', 'Baby One More Time was released in 1998.')
  const hit2 = chunk('h2', 'The single Baby One More Time topped charts in 1998.')
  const miss = chunk('m1', 'Unrelated content about something else entirely.')
  // Chunk with only the supporting anchor "1998" — should NOT be a hit
  const supportingOnly = chunk('s1', 'In 1998, Britney released her debut.')

  const debutCase: BenchmarkCase = {
    id: 'debut-single',
    query: "What was Britney Spears' debut single?",
    requiredAnchors: ['Baby One More Time'],
    supportingAnchors: ['1998'],
    kind: 'positive',
  }

  it('hit@k is 1 when any top-k chunk is a hit', () => {
    expect(hitAtK([miss, hit1, hit2], debutCase, 3)).toBe(1)
    expect(hitAtK([hit1, miss, miss], debutCase, 3)).toBe(1)
  })

  it('hit@k is 0 when no top-k chunk is a hit', () => {
    expect(hitAtK([miss, miss, miss], debutCase, 3)).toBe(0)
  })

  it('hit@k is 0 when only supporting anchors match (not a hit)', () => {
    expect(hitAtK([supportingOnly, supportingOnly], debutCase, 3)).toBe(0)
  })

  it('hit@k respects the k cutoff', () => {
    // hit is at position 3 (index 2) — k=2 should miss it
    expect(hitAtK([miss, miss, hit1], debutCase, 2)).toBe(0)
    expect(hitAtK([miss, miss, hit1], debutCase, 3)).toBe(1)
  })

  it('hit@k is 0 for empty results', () => {
    expect(hitAtK([], debutCase, 5)).toBe(0)
  })

  it('recall@k counts distinct required anchors found across top-k', () => {
    // hit1 has "Baby One More Time" → 1/1 = 1
    expect(recallAtK([hit1], debutCase, 5)).toBe(1)
    // supportingOnly has only "1998" (supporting), not "Baby One More Time" (required) → 0/1 = 0
    expect(recallAtK([supportingOnly], debutCase, 5)).toBe(0)
  })

  it('recall@k with multiple required anchors measures fraction covered', () => {
    const multiCase = posCase('birthplace', ['McComb', 'Mississippi'], ['1981'])
    const partialChunk = chunk('p', 'McComb is a city in Mississippi.')
    expect(recallAtK([partialChunk], multiCase, 5)).toBe(1) // both found

    const onlyMcComb = chunk('p2', 'McComb is a city.')
    expect(recallAtK([onlyMcComb], multiCase, 5)).toBe(0.5) // 1/2
  })

  it('recall@k is 0 when no required anchors are found', () => {
    expect(recallAtK([miss], debutCase, 5)).toBe(0)
  })

  it('recall@k is 0 for negative cases (no required anchors to cover)', () => {
    const neg = negCase('n')
    expect(recallAtK([hit1], neg, 5)).toBe(0)
  })

  it('precision@k is hits / k over the top-k window', () => {
    // 1 hit in top-3 → 1/3
    expect(precisionAtK([hit1, miss, miss], debutCase, 3)).toBeCloseTo(1 / 3)
    // 2 hits in top-3 → 2/3
    expect(precisionAtK([hit1, hit2, miss], debutCase, 3)).toBeCloseTo(2 / 3)
  })

  it('precision@k does not count supporting-only chunks as hits', () => {
    // supportingOnly has "1998" but not "Baby One More Time" → not a hit
    expect(precisionAtK([supportingOnly, miss, miss], debutCase, 3)).toBe(0)
  })

  it('precision@k is 0 for positive case with empty results', () => {
    expect(precisionAtK([], debutCase, 3)).toBe(0)
  })

  it('precision@k is 0 for negative case with any results', () => {
    const neg = negCase('n')
    expect(precisionAtK([hit1], neg, 3)).toBe(0)
  })

  it('precision@k is 1 for negative case with empty results', () => {
    const neg = negCase('n')
    expect(precisionAtK([], neg, 3)).toBe(1)
  })

  it('reciprocalRank is 1/rank of first hit', () => {
    expect(reciprocalRank([hit1, hit2, miss], debutCase)).toBe(1)
    expect(reciprocalRank([miss, hit1, miss], debutCase)).toBe(1 / 2)
    expect(reciprocalRank([miss, miss, hit1], debutCase)).toBe(1 / 3)
  })

  it('reciprocalRank skips supporting-only chunks (not hits)', () => {
    // supportingOnly is at rank 1 but is NOT a hit; hit1 at rank 2 IS a hit
    expect(reciprocalRank([supportingOnly, hit1, miss], debutCase)).toBe(1 / 2)
  })

  it('reciprocalRank is 0 when no hit is found', () => {
    expect(reciprocalRank([miss, miss, miss], debutCase)).toBe(0)
    expect(reciprocalRank([], debutCase)).toBe(0)
  })

  it('reciprocalRank is 0 when only supporting anchors match', () => {
    expect(reciprocalRank([supportingOnly, supportingOnly], debutCase)).toBe(0)
  })

  it('reciprocalRank for negative case is 1 when empty, 0 otherwise', () => {
    const neg = negCase('n')
    expect(reciprocalRank([], neg)).toBe(1)
    expect(reciprocalRank([hit1], neg)).toBe(0)
  })
})

describe('search-benchmark.evaluation — falsePositiveRate', () => {
  const neg1 = negCase('neg-1')
  const neg2 = negCase('neg-2')
  const neg3 = negCase('neg-3')

  it('is 0 when no negative case returns results', () => {
    const map = new Map<string, BenchmarkChunk[]>()
    expect(falsePositiveRate(map, [neg1, neg2, neg3])).toBe(0)
  })

  it('is 1 when every negative case returns results', () => {
    const map = new Map<string, BenchmarkChunk[]>([
      ['neg-1', [chunk('x', 'Paris')]],
      ['neg-2', [chunk('y', 'plants')]],
      ['neg-3', [chunk('z', 'Shakespeare')]],
    ])
    expect(falsePositiveRate(map, [neg1, neg2, neg3])).toBe(1)
  })

  it('is the fraction of negative cases with non-empty results', () => {
    const map = new Map<string, BenchmarkChunk[]>([
      ['neg-1', [chunk('x', 'Paris')]],
      // neg-2 and neg-3 missing → empty
    ])
    expect(falsePositiveRate(map, [neg1, neg2, neg3])).toBeCloseTo(1 / 3)
  })

  it('is 0 when there are no negative cases', () => {
    expect(falsePositiveRate(new Map(), [])).toBe(0)
  })
})

describe('search-benchmark.evaluation — evaluateAll', () => {
  const pos1: BenchmarkCase = {
    id: 'p1',
    query: 'q1',
    requiredAnchors: ['alpha', 'beta'],
    supportingAnchors: ['extra'],
    kind: 'positive',
  }
  const pos2: BenchmarkCase = {
    id: 'p2',
    query: 'q2',
    requiredAnchors: ['gamma'],
    supportingAnchors: [],
    kind: 'positive',
  }
  const neg1 = negCase('n1')

  it('aggregates metrics across positive and negative cases', () => {
    const map = new Map<string, BenchmarkChunk[]>([
      // p1: hit at rank 1 (both required anchors present), supporting also present
      ['p1', [chunk('c1', 'alpha and beta and extra'), chunk('c2', 'noise')]],
      // p2: no hit → hit=0, recall=0, prec=0, rr=0
      ['p2', [chunk('c3', 'unrelated')]],
      // n1: no results → no false positive
      ['n1', []],
    ])
    const k = 2
    const m = evaluateAll([pos1, pos2, neg1], map, k)

    expect(m.k).toBe(k)
    // hit@k: (1 + 0) / 2 = 0.5
    expect(m.hitAtK).toBeCloseTo(0.5)
    // recall@k: p1 has 2/2 required, p2 has 0/1 → (1 + 0) / 2 = 0.5
    expect(m.recallAtK).toBeCloseTo(0.5)
    // precision@k: p1 has 1 hit in top-2 → 1/2; p2 has 0 → 0; avg = 0.25
    expect(m.precisionAtK).toBeCloseTo(0.25)
    // mrr: (1 + 0) / 2 = 0.5
    expect(m.mrr).toBeCloseTo(0.5)
    // FP rate: 0 / 1 = 0
    expect(m.falsePositiveRate).toBe(0)
  })

  it('supporting-only match does not count as hit in evaluateAll', () => {
    const map = new Map<string, BenchmarkChunk[]>([
      // p1: only "extra" (supporting) matches, not "alpha" or "beta" → not a hit
      ['p1', [chunk('c1', 'just extra here')]],
      ['p2', [chunk('c3', 'gamma found')]],
      ['n1', []],
    ])
    const m = evaluateAll([pos1, pos2, neg1], map, 2)
    // p1: hit=0, recall=0; p2: hit=1, recall=1 → avg hit = 0.5
    expect(m.hitAtK).toBeCloseTo(0.5)
    expect(m.recallAtK).toBeCloseTo(0.5)
  })

  it('treats missing case ids as empty results', () => {
    const map = new Map<string, BenchmarkChunk[]>()
    const m = evaluateAll([pos1], map, 5)
    expect(m.hitAtK).toBe(0)
    expect(m.recallAtK).toBe(0)
    expect(m.mrr).toBe(0)
  })

  it('handles empty case list without dividing by zero', () => {
    const m = evaluateAll([], new Map(), 5)
    // positive.length is 0 → denominator falls back to 1
    expect(m.hitAtK).toBe(0)
    expect(m.recallAtK).toBe(0)
    expect(m.precisionAtK).toBe(0)
    expect(m.mrr).toBe(0)
    expect(m.falsePositiveRate).toBe(0)
  })
})

describe('search-benchmark.evaluation — empty results', () => {
  const case_: BenchmarkCase = {
    id: 'x',
    query: 'q',
    requiredAnchors: ['alpha'],
    supportingAnchors: ['beta'],
    kind: 'positive',
  }

  it('all per-case metrics degrade gracefully on empty results', () => {
    expect(hitAtK([], case_, 5)).toBe(0)
    expect(recallAtK([], case_, 5)).toBe(0)
    expect(precisionAtK([], case_, 5)).toBe(0)
    expect(reciprocalRank([], case_)).toBe(0)
  })
})
