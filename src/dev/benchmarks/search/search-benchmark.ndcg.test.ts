import { describe, it, expect } from 'vitest'
import {
  dcgAtK,
  idcgAtK,
  ndcgAtK,
  hitAtKGraded,
  recallAtKGraded,
  gradedMetricsForCase,
  evaluateGraded,
} from './search-benchmark.ndcg'
import { resolveRelevance, relevanceVector } from './search-benchmark.relevance'
import type { BenchmarkChunk, GradedBenchmarkCase } from './search-benchmark.types'

/** Helper: build a chunk with a single text body */
function chunk(id: string, text: string): BenchmarkChunk {
  return { chunkId: id, text, searchText: text }
}

describe('search-benchmark.ndcg — dcgAtK', () => {
  it('computes DCG for a perfect ranking', () => {
    // rel = [2, 1, 0], k = 3
    // gain = [3, 1, 0], discount = [1, log2(3), log2(4)]
    // DCG = 3/1 + 1/log2(3) + 0/log2(4) = 3 + 0.6309... = 3.6309...
    const dcg = dcgAtK([2, 1, 0], 3)
    expect(dcg).toBeCloseTo(3 + 1 / Math.log2(3))
  })

  it('returns 0 for all-zero relevances', () => {
    expect(dcgAtK([0, 0, 0], 3)).toBe(0)
  })

  it('respects the k cutoff', () => {
    // Only first 2 positions count
    const dcg = dcgAtK([2, 2, 2], 2)
    expect(dcg).toBeCloseTo(3 + 3 / Math.log2(3))
  })

  it('handles empty relevances', () => {
    expect(dcgAtK([], 5)).toBe(0)
  })
})

describe('search-benchmark.ndcg — idcgAtK', () => {
  it('sorts descending before computing DCG', () => {
    // [0, 2, 1] sorted → [2, 1, 0]
    expect(idcgAtK([0, 2, 1], 3)).toBeCloseTo(dcgAtK([2, 1, 0], 3))
  })

  it('equals dcgAtK when already sorted descending', () => {
    expect(idcgAtK([2, 1, 0], 3)).toBeCloseTo(dcgAtK([2, 1, 0], 3))
  })
})

describe('search-benchmark.ndcg — ndcgAtK', () => {
  it('returns 1 for a perfect ranking', () => {
    expect(ndcgAtK([2, 1, 0], 3)).toBeCloseTo(1)
    expect(ndcgAtK([2, 2, 1], 5)).toBeCloseTo(1)
  })

  it('returns 0 for an all-zero ranking', () => {
    expect(ndcgAtK([0, 0, 0], 3)).toBe(0)
  })

  it('returns 0 for empty ranking', () => {
    expect(ndcgAtK([], 10)).toBe(0)
  })

  it('distinguishes grade-2 at position 1 vs position 9', () => {
    // Case: one grade-2 document among 9 irrelevant ones.
    // Ideal: [2, 0, 0, 0, 0, 0, 0, 0, 0]
    // Perfect: grade-2 at position 1 → nDCG = 1
    // Worst: grade-2 at position 9 → nDCG < 1
    const perfect = [2, 0, 0, 0, 0, 0, 0, 0, 0]
    const worst = [0, 0, 0, 0, 0, 0, 0, 0, 2]

    const ndcgPerfect = ndcgAtK(perfect, 10)
    const ndcgWorst = ndcgAtK(worst, 10)

    expect(ndcgPerfect).toBeCloseTo(1)
    expect(ndcgWorst).toBeLessThan(1)
    // The worst ranking should have significantly lower nDCG
    // because the gain of 3 is discounted by log2(10) ≈ 3.32
    expect(ndcgWorst).toBeCloseTo(3 / Math.log2(10) / 3) // (2^2-1)/log2(10) / (2^2-1)/log2(2)
    expect(ndcgWorst).toBeLessThan(0.5)
  })

  it('handles mixed grades correctly', () => {
    // [1, 2, 0] vs ideal [2, 1, 0]
    const dcgActual = dcgAtK([1, 2, 0], 3)
    const dcgIdeal = idcgAtK([1, 2, 0], 3)
    expect(ndcgAtK([1, 2, 0], 3)).toBeCloseTo(dcgActual / dcgIdeal)
  })

  it('is 1 when ranking matches ideal even with mixed grades', () => {
    // [2, 1, 1, 0] is already ideal
    expect(ndcgAtK([2, 1, 1, 0], 10)).toBeCloseTo(1)
  })
})

describe('search-benchmark.ndcg — hitAtKGraded', () => {
  it('returns 1 when any top-k relevance > 0', () => {
    expect(hitAtKGraded([0, 0, 1, 0], 4)).toBe(1)
    expect(hitAtKGraded([2, 0, 0], 3)).toBe(1)
  })

  it('returns 0 when no top-k relevance > 0', () => {
    expect(hitAtKGraded([0, 0, 0], 3)).toBe(0)
  })

  it('respects the k cutoff', () => {
    expect(hitAtKGraded([0, 0, 1], 2)).toBe(0)
    expect(hitAtKGraded([0, 0, 1], 3)).toBe(1)
  })

  it('returns 0 for empty ranking', () => {
    expect(hitAtKGraded([], 10)).toBe(0)
  })
})

describe('search-benchmark.ndcg — recallAtKGraded', () => {
  it('returns 1 when all gain is in top-k', () => {
    expect(recallAtKGraded([2, 1, 0], 3)).toBeCloseTo(1)
    expect(recallAtKGraded([2, 1], 10)).toBeCloseTo(1)
  })

  it('returns 0 when no gain exists', () => {
    expect(recallAtKGraded([0, 0, 0], 3)).toBe(0)
  })

  it('returns fraction of total gain captured', () => {
    // gain = [3, 1, 0, 0, 0], total = 4, top-2 gain = 4 → 1
    expect(recallAtKGraded([2, 1, 0, 0, 0], 2)).toBeCloseTo(1)
    // top-1 gain = 3, total = 4 → 3/4
    expect(recallAtKGraded([2, 1, 0, 0, 0], 1)).toBeCloseTo(3 / 4)
  })

  it('returns 0 for empty ranking', () => {
    expect(recallAtKGraded([], 10)).toBe(0)
  })
})

describe('search-benchmark.ndcg — gradedMetricsForCase', () => {
  const case_: GradedBenchmarkCase = {
    id: 'test',
    query: 'test query',
    fragments: [
      { text: 'alpha fact', grade: 2 },
      { text: 'beta context', grade: 1 },
    ],
    kind: 'positive',
  }

  it('returns perfect scores when relevant chunks are at the top', () => {
    const chunks = [
      chunk('c1', 'contains alpha fact here'),
      chunk('c2', 'contains beta context here'),
      chunk('c3', 'unrelated noise'),
    ]
    const m = gradedMetricsForCase(chunks, case_)
    expect(m.ndcg).toBeCloseTo(1)
    expect(m.hit).toBe(1)
    expect(m.recall).toBeCloseTo(1)
  })

  it('returns zero scores when no chunks are relevant', () => {
    const chunks = [
      chunk('c1', 'unrelated'),
      chunk('c2', 'noise'),
    ]
    const m = gradedMetricsForCase(chunks, case_)
    expect(m.ndcg).toBe(0)
    expect(m.hit).toBe(0)
    expect(m.recall).toBe(0)
  })
})

describe('search-benchmark.ndcg — evaluateGraded', () => {
  const case1: GradedBenchmarkCase = {
    id: 'c1',
    query: 'q1',
    fragments: [{ text: 'answer one', grade: 2 }],
    kind: 'positive',
  }
  const case2: GradedBenchmarkCase = {
    id: 'c2',
    query: 'q2',
    fragments: [{ text: 'answer two', grade: 2 }],
    kind: 'positive',
  }

  it('averages metrics across positive cases', () => {
    const map = new Map<string, BenchmarkChunk[]>([
      ['c1', [chunk('x', 'answer one'), chunk('y', 'noise')]],
      ['c2', [chunk('a', 'noise'), chunk('b', 'answer two')]],
    ])
    const m = evaluateGraded([case1, case2], map, 10)
    // c1: ndcg=1, hit=1, recall=1
    // c2: ndcg=1, hit=1, recall=1 (answer at position 2, but only 2 results so ideal is also [0,2])
    // Actually for c2: rels = [0, 2], ideal = [2, 0]
    // DCG = 0 + 3/log2(3) = 1.893, IDCG = 3 + 0 = 3, nDCG = 0.631
    // Hit = 1, Recall = 3/3 = 1
    expect(m.hitAt10).toBeCloseTo(1)
    expect(m.recallAt10).toBeCloseTo(1)
    expect(m.ndcgAt10).toBeGreaterThan(0)
    expect(m.ndcgAt10).toBeLessThanOrEqual(1)
  })

  it('treats missing case ids as empty results', () => {
    const map = new Map<string, BenchmarkChunk[]>()
    const m = evaluateGraded([case1], map, 10)
    expect(m.ndcgAt10).toBe(0)
    expect(m.hitAt10).toBe(0)
    expect(m.recallAt10).toBe(0)
  })

  it('returns zeros for empty case list', () => {
    const m = evaluateGraded([], new Map(), 10)
    expect(m.ndcgAt10).toBe(0)
    expect(m.hitAt10).toBe(0)
    expect(m.recallAt10).toBe(0)
  })

  it('ignores negative cases in the average', () => {
    const negCase: GradedBenchmarkCase = {
      id: 'neg',
      query: 'neg',
      fragments: [],
      kind: 'negative',
    }
    const map = new Map<string, BenchmarkChunk[]>([
      ['c1', [chunk('x', 'answer one')]],
    ])
    const m = evaluateGraded([case1, negCase], map, 10)
    // Only case1 counts
    expect(m.ndcgAt10).toBeCloseTo(1)
    expect(m.hitAt10).toBe(1)
    expect(m.recallAt10).toBeCloseTo(1)
  })
})

describe('search-benchmark.relevance — resolveRelevance', () => {
  const case_: GradedBenchmarkCase = {
    id: 'test',
    query: 'test',
    fragments: [
      { text: 'alpha', grade: 2 },
      { text: 'beta', grade: 1 },
    ],
    kind: 'positive',
  }

  it('returns max grade when chunk matches multiple fragments', () => {
    const chunks = [chunk('c1', 'has alpha and beta')]
    const result = resolveRelevance(chunks, case_)
    expect(result).toEqual([{ chunkId: 'c1', grade: 2 }])
  })

  it('returns grade 1 when only grade-1 fragment matches', () => {
    const chunks = [chunk('c1', 'has beta only')]
    const result = resolveRelevance(chunks, case_)
    expect(result).toEqual([{ chunkId: 'c1', grade: 1 }])
  })

  it('omits chunks with no matching fragments', () => {
    const chunks = [chunk('c1', 'unrelated')]
    const result = resolveRelevance(chunks, case_)
    expect(result).toEqual([])
  })

  it('returns empty for negative cases', () => {
    const negCase: GradedBenchmarkCase = {
      id: 'neg',
      query: 'neg',
      fragments: [],
      kind: 'negative',
    }
    const chunks = [chunk('c1', 'alpha beta')]
    expect(resolveRelevance(chunks, negCase)).toEqual([])
  })

  it('works with both 104 and 166 chunks (same logic)', () => {
    // Generate 104 chunks, 5 relevant
    const chunks104 = Array.from({ length: 104 }, (_, i) =>
      chunk(`c${i}`, i < 5 ? 'alpha fact' : 'noise'),
    )
    const result104 = resolveRelevance(chunks104, case_)
    expect(result104).toHaveLength(5)

    // Generate 166 chunks, 5 relevant (same fragments)
    const chunks166 = Array.from({ length: 166 }, (_, i) =>
      chunk(`c${i}`, i < 5 ? 'alpha fact' : 'noise'),
    )
    const result166 = resolveRelevance(chunks166, case_)
    expect(result166).toHaveLength(5)
  })
})

describe('search-benchmark.relevance — relevanceVector', () => {
  const case_: GradedBenchmarkCase = {
    id: 'test',
    query: 'test',
    fragments: [
      { text: 'alpha', grade: 2 },
      { text: 'beta', grade: 1 },
    ],
    kind: 'positive',
  }

  it('returns grades in rank order', () => {
    const chunks = [
      chunk('c1', 'unrelated'),
      chunk('c2', 'has alpha'),
      chunk('c3', 'has beta'),
      chunk('c4', 'unrelated'),
    ]
    expect(relevanceVector(chunks, case_)).toEqual([0, 2, 1, 0])
  })
})
