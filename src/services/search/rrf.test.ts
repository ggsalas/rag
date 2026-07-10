import { describe, it, expect } from 'vitest'
import { rrfFuse } from './rrf'

interface Item {
  id: string
  score: number
}

const id = (i: Item) => i.id

describe('rrfFuse', () => {
  it('returns an empty array when given no rankings', () => {
    expect(rrfFuse<Item>([], id)).toEqual([])
  })

  it('preserves order when given a single ranking', () => {
    const ranking: Item[] = [
      { id: 'a', score: 0.9 },
      { id: 'b', score: 0.8 },
      { id: 'c', score: 0.7 },
    ]
    const fused = rrfFuse([ranking], id)
    expect(fused.map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })

  it('boosts items that appear consistently across rankings', () => {
    const r1: Item[] = [
      { id: 'a', score: 1 },
      { id: 'b', score: 1 },
    ]
    const r2: Item[] = [
      { id: 'c', score: 1 },
      { id: 'b', score: 1 },
    ]
    const fused = rrfFuse([r1, r2], id)
    // 'b' appears in both (rank 2 in each) → should rank ahead of 'a' or 'c'
    // which each only appear once at rank 1
    expect(fused[0]!.id).toBe('b')
  })

  it('deduplicates items across rankings', () => {
    const r1: Item[] = [
      { id: 'a', score: 1 },
      { id: 'b', score: 1 },
    ]
    const r2: Item[] = [
      { id: 'a', score: 1 },
      { id: 'b', score: 1 },
    ]
    const fused = rrfFuse([r1, r2], id)
    expect(fused).toHaveLength(2)
    expect(fused.map((i) => i.id).sort()).toEqual(['a', 'b'])
  })

  it('respects the limit parameter', () => {
    const r1: Item[] = [
      { id: 'a', score: 1 },
      { id: 'b', score: 1 },
      { id: 'c', score: 1 },
    ]
    expect(rrfFuse([r1], id, 60, 2)).toHaveLength(2)
  })

  it('normalises the top score to 1', () => {
    const r1: Item[] = [{ id: 'a', score: 999 }]
    const r2: Item[] = [{ id: 'a', score: 999 }]
    const fused = rrfFuse([r1, r2], id, 60)
    expect(fused[0]!.score).toBeCloseTo(1, 6)
  })

  it('scales non-top scores proportionally to the top', () => {
    // Two rankings, both put 'a' at rank 1 and 'b' at rank 2. Raw RRF:
    //   a = 1/61 + 1/61 = 2/61
    //   b = 1/62 + 1/62 = 2/62
    // Normalised: a = 1, b = (2/62) / (2/61) = 61/62 ≈ 0.9839
    const r1: Item[] = [{ id: 'a', score: 1 }, { id: 'b', score: 1 }]
    const r2: Item[] = [{ id: 'a', score: 1 }, { id: 'b', score: 1 }]
    const fused = rrfFuse([r1, r2], id, 60)
    expect(fused[0]!.score).toBeCloseTo(1, 6)
    expect(fused[1]!.score).toBeCloseTo(61 / 62, 6)
  })

  it('handles items only present in some rankings', () => {
    const r1: Item[] = [
      { id: 'a', score: 1 },
      { id: 'b', score: 1 },
    ]
    const r2: Item[] = [{ id: 'c', score: 1 }]
    const fused = rrfFuse([r1, r2], id)
    expect(fused.map((i) => i.id).sort()).toEqual(['a', 'b', 'c'])
  })
})
