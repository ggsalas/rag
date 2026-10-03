import { describe, it, expect } from 'vitest'
import { scanCorpusCoverage } from './corpus-coverage'
import type { CorpusChunk } from './corpus-coverage'
import type { BenchmarkCase } from './search-benchmark.types'

/** Helper: build a corpus chunk */
function corpusChunk(
  chunkId: string,
  chunkIndex: number,
  documentName: string,
  text: string,
): CorpusChunk {
  return {
    chunkId,
    chunkIndex,
    documentName,
    text,
    searchText: text,
  }
}

/** Helper: build a positive case */
function posCase(
  id: string,
  requiredAnchors: string[],
  supportingAnchors: string[] = [],
): BenchmarkCase {
  return { id, query: 'q', requiredAnchors, supportingAnchors, kind: 'positive' }
}

describe('corpus-coverage — scanCorpusCoverage', () => {
  it('returns empty coverage when no chunks are provided', () => {
    const cases = [posCase('test', ['anchor1'])]
    const result = scanCorpusCoverage([], cases)

    expect(result).toHaveLength(1)
    expect(result[0]!.caseId).toBe('test')
    expect(result[0]!.requiredAnchors[0]!.found).toBe(false)
    expect(result[0]!.requiredAnchors[0]!.matchingChunkIndices).toEqual([])
    expect(result[0]!.totalChunks).toBe(0)
  })

  it('detects anchor presence in chunks', () => {
    const chunks = [
      corpusChunk('c1', 0, 'doc1', 'Baby One More Time was released in 1998'),
      corpusChunk('c2', 1, 'doc1', 'Oops I Did It Again was her second album'),
    ]
    const cases = [posCase('debut', ['Baby One More Time'])]
    const result = scanCorpusCoverage(chunks, cases)

    expect(result[0]!.requiredAnchors[0]!.found).toBe(true)
    expect(result[0]!.requiredAnchors[0]!.matchingChunkIndices).toEqual([0])
    expect(result[0]!.requiredAnchors[0]!.matchingChunkIds).toEqual(['c1'])
  })

  it('returns multiple chunk indices when anchor appears in multiple chunks', () => {
    const chunks = [
      corpusChunk('c1', 0, 'doc1', 'Baby One More Time debut'),
      corpusChunk('c2', 1, 'doc1', 'Baby One More Time again'),
      corpusChunk('c3', 2, 'doc1', 'No match here'),
    ]
    const cases = [posCase('test', ['Baby One More Time'])]
    const result = scanCorpusCoverage(chunks, cases)

    expect(result[0]!.requiredAnchors[0]!.found).toBe(true)
    expect(result[0]!.requiredAnchors[0]!.matchingChunkIndices).toEqual([0, 1])
    expect(result[0]!.requiredAnchors[0]!.matchingChunkIds).toEqual(['c1', 'c2'])
  })

  it('handles multiple anchors per case', () => {
    const chunks = [
      corpusChunk('c1', 0, 'doc1', 'McComb Mississippi birthplace'),
      corpusChunk('c2', 1, 'doc1', 'Only McComb mentioned'),
    ]
    const cases = [posCase('birthplace', ['McComb', 'Mississippi'])]
    const result = scanCorpusCoverage(chunks, cases)

    // Both anchors found
    expect(result[0]!.requiredAnchors[0]!.found).toBe(true)
    expect(result[0]!.requiredAnchors[0]!.matchingChunkIndices).toEqual([0, 1])

    // Only second chunk has Mississippi
    expect(result[0]!.requiredAnchors[1]!.found).toBe(true)
    expect(result[0]!.requiredAnchors[1]!.matchingChunkIndices).toEqual([0])
  })

  it('distinguishes required from supporting anchors', () => {
    const chunks = [
      corpusChunk('c1', 0, 'doc1', 'Baby One More Time 1998'),
    ]
    const cases = [
      posCase('debut', ['Baby One More Time'], ['1998', 'Toxic']),
    ]
    const result = scanCorpusCoverage(chunks, cases)

    // Required anchor found
    expect(result[0]!.requiredAnchors[0]!.found).toBe(true)
    expect(result[0]!.requiredAnchors[0]!.matchingChunkIndices).toEqual([0])

    // Supporting anchor "1998" found
    expect(result[0]!.supportingAnchors[0]!.found).toBe(true)
    expect(result[0]!.supportingAnchors[0]!.matchingChunkIndices).toEqual([0])

    // Supporting anchor "Toxic" not found
    expect(result[0]!.supportingAnchors[1]!.found).toBe(false)
    expect(result[0]!.supportingAnchors[1]!.matchingChunkIndices).toEqual([])
  })

  it('is case-insensitive', () => {
    const chunks = [
      corpusChunk('c1', 0, 'doc1', 'BABY ONE MORE TIME'),
    ]
    const cases = [posCase('test', ['baby one more time'])]
    const result = scanCorpusCoverage(chunks, cases)

    expect(result[0]!.requiredAnchors[0]!.found).toBe(true)
  })

  it('checks both text and searchText', () => {
    const chunks = [
      {
        chunkId: 'c1',
        chunkIndex: 0,
        documentName: 'doc1',
        text: 'display text',
        searchText: 'retrieval text with Toxic',
      },
    ]
    const cases = [posCase('test', ['Toxic'])]
    const result = scanCorpusCoverage(chunks, cases)

    expect(result[0]!.requiredAnchors[0]!.found).toBe(true)
  })

  it('handles multiple cases', () => {
    const chunks = [
      corpusChunk('c1', 0, 'doc1', 'Baby One More Time'),
      corpusChunk('c2', 1, 'doc1', 'Toxic album'),
    ]
    const cases = [
      posCase('case1', ['Baby One More Time']),
      posCase('case2', ['Toxic']),
    ]
    const result = scanCorpusCoverage(chunks, cases)

    expect(result).toHaveLength(2)
    expect(result[0]!.caseId).toBe('case1')
    expect(result[0]!.requiredAnchors[0]!.found).toBe(true)
    expect(result[1]!.caseId).toBe('case2')
    expect(result[1]!.requiredAnchors[0]!.found).toBe(true)
  })

  it('reports totalChunks correctly', () => {
    const chunks = [
      corpusChunk('c1', 0, 'doc1', 'text1'),
      corpusChunk('c2', 1, 'doc1', 'text2'),
      corpusChunk('c3', 2, 'doc1', 'text3'),
    ]
    const cases = [posCase('test', ['anchor'])]
    const result = scanCorpusCoverage(chunks, cases)

    expect(result[0]!.totalChunks).toBe(3)
  })

  it('handles cases with no anchors', () => {
    const chunks = [corpusChunk('c1', 0, 'doc1', 'text')]
    const cases = [
      {
        id: 'neg',
        query: 'q',
        requiredAnchors: [],
        supportingAnchors: [],
        kind: 'negative' as const,
      },
    ]
    const result = scanCorpusCoverage(chunks, cases)

    expect(result[0]!.requiredAnchors).toEqual([])
    expect(result[0]!.supportingAnchors).toEqual([])
  })
})
