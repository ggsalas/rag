import { describe, it, expect, vi, beforeEach } from 'vitest'
import { search } from './search.service'
import { DEFAULT_MAX_RESULTS, MIN_ABSOLUTE_SCORE } from '@/lib/constants'

// Mock the embedding service
vi.mock('@/services/embedding/embedding.service', () => ({
  embed: vi.fn(),
}))

// Mock the vector store
vi.mock('@/services/embedding/vector-store', () => ({
  searchByVector: vi.fn(),
  searchHybrid: vi.fn(),
}))

import { embed } from '@/services/embedding/embedding.service'
import { searchHybrid } from '@/services/embedding/vector-store'

const mockEmbed = vi.mocked(embed)
const mockSearchHybrid = vi.mocked(searchHybrid)

describe('search.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return empty array for empty query', async () => {
    const results = await search('', 'lib-1')
    expect(results).toEqual([])
    expect(mockEmbed).not.toHaveBeenCalled()
  })

  it('should return empty array for whitespace-only query', async () => {
    const results = await search('   ', 'lib-1')
    expect(results).toEqual([])
    expect(mockEmbed).not.toHaveBeenCalled()
  })

  it('should embed query and perform hybrid search', async () => {
    const fakeEmbedding = Array(384).fill(0.1)
    mockEmbed.mockResolvedValue(fakeEmbedding)
    mockSearchHybrid.mockResolvedValue([
      {
        chunkId: 'chunk-1',
        documentId: 'doc-1',
        documentName: 'test.pdf',
        text: 'sample text',
        searchText: 'sample text',
        sectionPath: [],
        headingText: '',
        score: 0.95,
        chunkIndex: 0,
      },
    ])

    const results = await search('test query', 'lib-1')

    expect(mockEmbed).toHaveBeenCalledWith('test query')
    expect(mockSearchHybrid).toHaveBeenCalledWith(
      'lib-1',
      'test query',
      fakeEmbedding,
      DEFAULT_MAX_RESULTS,
      undefined,
    )
    expect(results).toHaveLength(1)
    expect(results[0]!.documentName).toBe('test.pdf')
    expect(results[0]!.score).toBe(0.95)
  })

  it('should pass custom topK to hybrid search', async () => {
    const fakeEmbedding = Array(384).fill(0.1)
    mockEmbed.mockResolvedValue(fakeEmbedding)
    mockSearchHybrid.mockResolvedValue([])

    await search('query', 'lib-1', 10)

    expect(mockSearchHybrid).toHaveBeenCalledWith(
      'lib-1',
      'query',
      fakeEmbedding,
      10,
      undefined,
    )
  })

  it('should trim query before embedding', async () => {
    const fakeEmbedding = Array(384).fill(0.1)
    mockEmbed.mockResolvedValue(fakeEmbedding)
    mockSearchHybrid.mockResolvedValue([])

    await search('  hello world  ', 'lib-1')

    expect(mockEmbed).toHaveBeenCalledWith('hello world')
    expect(mockSearchHybrid).toHaveBeenCalledWith(
      'lib-1',
      'hello world',
      fakeEmbedding,
      DEFAULT_MAX_RESULTS,
      undefined,
    )
  })

  it('should return results with correct SearchResult shape', async () => {
    const fakeEmbedding = Array(384).fill(0.1)
    mockEmbed.mockResolvedValue(fakeEmbedding)
    mockSearchHybrid.mockResolvedValue([
      {
        chunkId: 'c-1',
        documentId: 'd-1',
        documentName: 'doc.txt',
        text: 'some text',
        searchText: 'some text',
        sectionPath: ['Section'],
        headingText: 'Section',
        score: 0.8,
        chunkIndex: 2,
      },
    ])

    const results = await search('query', 'lib-1')

    expect(results[0]).toEqual({
      chunkId: 'c-1',
      documentId: 'd-1',
      documentName: 'doc.txt',
      text: 'some text',
      searchText: 'some text',
      sectionPath: ['Section'],
      headingText: 'Section',
      score: 0.8,
      chunkIndex: 2,
    })
  })

  it('should pass custom weights to hybrid search', async () => {
    const fakeEmbedding = Array(384).fill(0.1)
    mockEmbed.mockResolvedValue(fakeEmbedding)
    mockSearchHybrid.mockResolvedValue([])

    const customWeights = { text: 0.3, vector: 0.7 }
    await search('query', 'lib-1', undefined, customWeights)

    expect(mockSearchHybrid).toHaveBeenCalledWith(
      'lib-1',
      'query',
      fakeEmbedding,
      DEFAULT_MAX_RESULTS,
      customWeights,
    )
  })

  describe('absolute score floor', () => {
    it('should discard results below MIN_ABSOLUTE_SCORE', async () => {
      const fakeEmbedding = Array(384).fill(0.1)
      mockEmbed.mockResolvedValue(fakeEmbedding)
      mockSearchHybrid.mockResolvedValue([
        {
          chunkId: 'c-1',
          documentId: 'd-1',
          documentName: 'doc.txt',
          text: 'low score',
          searchText: 'low score',
          sectionPath: [],
          headingText: '',
          score: MIN_ABSOLUTE_SCORE - 0.1, // Below floor
          chunkIndex: 0,
        },
        {
          chunkId: 'c-2',
          documentId: 'd-1',
          documentName: 'doc.txt',
          text: 'high score',
          searchText: 'high score',
          sectionPath: [],
          headingText: '',
          score: MIN_ABSOLUTE_SCORE + 0.1, // Above floor
          chunkIndex: 1,
        },
      ])

      const results = await search('query', 'lib-1')

      expect(results).toHaveLength(1)
      expect(results[0]!.chunkId).toBe('c-2')
      expect(results[0]!.score).toBe(MIN_ABSOLUTE_SCORE + 0.1)
    })

    it('should retain results at or above MIN_ABSOLUTE_SCORE', async () => {
      const fakeEmbedding = Array(384).fill(0.1)
      mockEmbed.mockResolvedValue(fakeEmbedding)
      mockSearchHybrid.mockResolvedValue([
        {
          chunkId: 'c-1',
          documentId: 'd-1',
          documentName: 'doc.txt',
          text: 'exact floor',
          searchText: 'exact floor',
          sectionPath: [],
          headingText: '',
          score: MIN_ABSOLUTE_SCORE, // Exactly at floor
          chunkIndex: 0,
        },
        {
          chunkId: 'c-2',
          documentId: 'd-1',
          documentName: 'doc.txt',
          text: 'above floor',
          searchText: 'above floor',
          sectionPath: [],
          headingText: '',
          score: 0.9,
          chunkIndex: 1,
        },
      ])

      // Set minScore to 0 to disable relative threshold and isolate absolute floor
      const results = await search('query', 'lib-1', undefined, undefined, 0)

      expect(results).toHaveLength(2)
    })

    it('should return empty array when all results are below absolute floor', async () => {
      const fakeEmbedding = Array(384).fill(0.1)
      mockEmbed.mockResolvedValue(fakeEmbedding)
      mockSearchHybrid.mockResolvedValue([
        {
          chunkId: 'c-1',
          documentId: 'd-1',
          documentName: 'doc.txt',
          text: 'low 1',
          searchText: 'low 1',
          sectionPath: [],
          headingText: '',
          score: 0.3,
          chunkIndex: 0,
        },
        {
          chunkId: 'c-2',
          documentId: 'd-1',
          documentName: 'doc.txt',
          text: 'low 2',
          searchText: 'low 2',
          sectionPath: [],
          headingText: '',
          score: 0.4,
          chunkIndex: 1,
        },
      ])

      const results = await search('query', 'lib-1')

      expect(results).toHaveLength(0)
    })

    it('should return empty array when hybrid search returns no results', async () => {
      const fakeEmbedding = Array(384).fill(0.1)
      mockEmbed.mockResolvedValue(fakeEmbedding)
      mockSearchHybrid.mockResolvedValue([])

      const results = await search('query', 'lib-1')

      expect(results).toHaveLength(0)
    })

    it('should apply both relative and absolute thresholds', async () => {
      const fakeEmbedding = Array(384).fill(0.1)
      mockEmbed.mockResolvedValue(fakeEmbedding)
      mockSearchHybrid.mockResolvedValue([
        {
          chunkId: 'c-1',
          documentId: 'd-1',
          documentName: 'doc.txt',
          text: 'top score',
          searchText: 'top score',
          sectionPath: [],
          headingText: '',
          score: 1.0,
          chunkIndex: 0,
        },
        {
          chunkId: 'c-2',
          documentId: 'd-1',
          documentName: 'doc.txt',
          text: 'medium score',
          searchText: 'medium score',
          sectionPath: [],
          headingText: '',
          score: 0.75, // Above absolute floor (0.5) but below 80% of top (0.8)
          chunkIndex: 1,
        },
        {
          chunkId: 'c-3',
          documentId: 'd-1',
          documentName: 'doc.txt',
          text: 'low but above absolute',
          searchText: 'low but above absolute',
          sectionPath: [],
          headingText: '',
          score: 0.6, // Above absolute floor (0.5) but below 80% of top (0.8)
          chunkIndex: 2,
        },
      ])

      // minScore = 80 means keep results >= 80% of top score (0.8)
      const results = await search('query', 'lib-1', undefined, undefined, 80)

      expect(results).toHaveLength(1)
      expect(results[0]!.chunkId).toBe('c-1')
    })
  })
})
