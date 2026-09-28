import { describe, it, expect, vi, beforeEach } from 'vitest'
import { search } from './search.service'
import { RERANK_CANDIDATE_POOL } from './rerank.service'

// Mock the embedding service
vi.mock('@/services/embedding/embedding.service', () => ({
  embed: vi.fn(),
}))

// Mock the vector store
vi.mock('@/services/embedding/vector-store', () => ({
  searchByVector: vi.fn(),
  searchHybrid: vi.fn(),
}))

// Mock the cross-encoder reranker service
vi.mock('./cross-encoder-reranker.service', () => ({
  rerankWithCrossEncoder: vi.fn((_query, candidates) => Promise.resolve(candidates)),
  isRerankerReady: vi.fn(() => false),
  loadRerankerModel: vi.fn(() => Promise.resolve(false)),
}))

import { embed } from '@/services/embedding/embedding.service'
import { searchHybrid } from '@/services/embedding/vector-store'
import {
  rerankWithCrossEncoder,
  isRerankerReady,
  loadRerankerModel,
} from './cross-encoder-reranker.service'

const mockEmbed = vi.mocked(embed)
const mockSearchHybrid = vi.mocked(searchHybrid)
const mockRerankWithCrossEncoder = vi.mocked(rerankWithCrossEncoder)
const mockIsRerankerReady = vi.mocked(isRerankerReady)
const mockLoadRerankerModel = vi.mocked(loadRerankerModel)

describe('search.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: cross-encoder not ready (degraded mode)
    mockIsRerankerReady.mockReturnValue(false)
    mockLoadRerankerModel.mockResolvedValue(false)
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
        text: 'sample test query text',
        searchText: 'sample test query text',
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
      RERANK_CANDIDATE_POOL,
      undefined,
    )
    expect(results).toHaveLength(1)
    expect(results[0]!.documentName).toBe('test.pdf')
    expect(results[0]!.score).toBe(0.95)
  })

  it('should request at least RERANK_CANDIDATE_POOL candidates from hybrid search', async () => {
    const fakeEmbedding = Array(384).fill(0.1)
    mockEmbed.mockResolvedValue(fakeEmbedding)
    mockSearchHybrid.mockResolvedValue([])

    await search('query', 'lib-1', 10)

    // maxResults=10 < RERANK_CANDIDATE_POOL, so candidate pool is expanded
    expect(mockSearchHybrid).toHaveBeenCalledWith(
      'lib-1',
      'query',
      fakeEmbedding,
      RERANK_CANDIDATE_POOL,
      undefined,
    )
  })

  it('should request maxResults when it exceeds RERANK_CANDIDATE_POOL', async () => {
    const fakeEmbedding = Array(384).fill(0.1)
    mockEmbed.mockResolvedValue(fakeEmbedding)
    mockSearchHybrid.mockResolvedValue([])

    await search('query', 'lib-1', 150)

    expect(mockSearchHybrid).toHaveBeenCalledWith(
      'lib-1',
      'query',
      fakeEmbedding,
      150,
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
      RERANK_CANDIDATE_POOL,
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

    const results = await search('some text', 'lib-1')

    expect(results[0]!.chunkId).toBe('c-1')
    expect(results[0]!.documentId).toBe('d-1')
    expect(results[0]!.documentName).toBe('doc.txt')
    expect(results[0]!.text).toBe('some text')
    expect(results[0]!.searchText).toBe('some text')
    expect(results[0]!.sectionPath).toEqual(['Section'])
    expect(results[0]!.headingText).toBe('Section')
    expect(results[0]!.score).toBe(0.8)
    expect(results[0]!.chunkIndex).toBe(2)
    // coverage=1 (both tokens found) + phrase=1 → 0.8*(1+0.15+0.20) = 1.08
    expect(results[0]!.rerankScore).toBeCloseTo(1.08)
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
      RERANK_CANDIDATE_POOL,
      customWeights,
    )
  })

  describe('cross-encoder integration', () => {
    it('should use cross-encoder when loaded', async () => {
      mockIsRerankerReady.mockReturnValue(true)
      const fakeEmbedding = Array(384).fill(0.1)
      mockEmbed.mockResolvedValue(fakeEmbedding)
      mockSearchHybrid.mockResolvedValue([
        {
          chunkId: 'c-1',
          documentId: 'd-1',
          documentName: 'doc.txt',
          text: 'alpha beta',
          searchText: 'alpha beta',
          sectionPath: [],
          headingText: '',
          score: 0.8,
          chunkIndex: 0,
        },
      ])

      // Mock cross-encoder to return reranked results with logit scores
      mockRerankWithCrossEncoder.mockResolvedValue([
        {
          chunkId: 'c-1',
          documentId: 'd-1',
          documentName: 'doc.txt',
          text: 'alpha beta',
          searchText: 'alpha beta',
          sectionPath: [],
          headingText: '',
          score: 0.8,
          chunkIndex: 0,
          rerankScore: 5.5, // logit from cross-encoder
        },
      ])

      const results = await search('alpha beta', 'lib-1')

      expect(mockRerankWithCrossEncoder).toHaveBeenCalledWith('alpha beta', expect.any(Array))
      expect(results).toHaveLength(1)
      expect(results[0]!.rerankScore).toBe(5.5)
    })

    it('should abstain when cross-encoder logit is below threshold', async () => {
      mockIsRerankerReady.mockReturnValue(true)
      const fakeEmbedding = Array(384).fill(0.1)
      mockEmbed.mockResolvedValue(fakeEmbedding)
      mockSearchHybrid.mockResolvedValue([
        {
          chunkId: 'c-1',
          documentId: 'd-1',
          documentName: 'doc.txt',
          text: 'unrelated content',
          searchText: 'unrelated content',
          sectionPath: [],
          headingText: '',
          score: 0.9,
          chunkIndex: 0,
        },
      ])

      // Mock cross-encoder to return low logit (irrelevant)
      mockRerankWithCrossEncoder.mockResolvedValue([
        {
          chunkId: 'c-1',
          documentId: 'd-1',
          documentName: 'doc.txt',
          text: 'unrelated content',
          searchText: 'unrelated content',
          sectionPath: [],
          headingText: '',
          score: 0.9,
          chunkIndex: 0,
          rerankScore: -7.0, // below threshold (-6.0) = irrelevant
        },
      ])

      const results = await search('alpha beta gamma', 'lib-1')

      // All results have logit < -6.0 (RERANKER_ABSTENTION_THRESHOLD) → abstain
      expect(results).toHaveLength(0)
    })

    it('should not abstain when at least one result has logit >= threshold', async () => {
      mockIsRerankerReady.mockReturnValue(true)
      const fakeEmbedding = Array(384).fill(0.1)
      mockEmbed.mockResolvedValue(fakeEmbedding)
      mockSearchHybrid.mockResolvedValue([
        {
          chunkId: 'c-1',
          documentId: 'd-1',
          documentName: 'doc.txt',
          text: 'alpha beta',
          searchText: 'alpha beta',
          sectionPath: [],
          headingText: '',
          score: 0.9,
          chunkIndex: 0,
        },
        {
          chunkId: 'c-2',
          documentId: 'd-1',
          documentName: 'doc.txt',
          text: 'unrelated',
          searchText: 'unrelated',
          sectionPath: [],
          headingText: '',
          score: 0.8,
          chunkIndex: 1,
        },
      ])

      // Mock cross-encoder: c-1 is relevant (logit=5.0), c-2 is not (logit=-3.0)
      mockRerankWithCrossEncoder.mockResolvedValue([
        {
          chunkId: 'c-1',
          documentId: 'd-1',
          documentName: 'doc.txt',
          text: 'alpha beta',
          searchText: 'alpha beta',
          sectionPath: [],
          headingText: '',
          score: 0.9,
          chunkIndex: 0,
          rerankScore: 5.0,
        },
        {
          chunkId: 'c-2',
          documentId: 'd-1',
          documentName: 'doc.txt',
          text: 'unrelated',
          searchText: 'unrelated',
          sectionPath: [],
          headingText: '',
          score: 0.8,
          chunkIndex: 1,
          rerankScore: -3.0,
        },
      ])

      const results = await search('alpha beta', 'lib-1')

      // c-1 has logit -3.0 >= -6.0 (RERANKER_ABSTENTION_THRESHOLD) → no abstention, both results returned
      expect(results).toHaveLength(2)
    })
  })

  describe('graceful degradation', () => {
    it('should return results without cross-encoder when model is not loaded', async () => {
      mockIsRerankerReady.mockReturnValue(false)
      const fakeEmbedding = Array(384).fill(0.1)
      mockEmbed.mockResolvedValue(fakeEmbedding)
      mockSearchHybrid.mockResolvedValue([
        {
          chunkId: 'c-1',
          documentId: 'd-1',
          documentName: 'doc.txt',
          text: 'alpha beta',
          searchText: 'alpha beta',
          sectionPath: [],
          headingText: '',
          score: 0.8,
          chunkIndex: 0,
        },
      ])

      const results = await search('alpha beta', 'lib-1')

      // Cross-encoder not ready → use lexical reranker only, no abstention
      expect(mockRerankWithCrossEncoder).not.toHaveBeenCalled()
      expect(results).toHaveLength(1)
      expect(results[0]!.rerankScore).toBeCloseTo(1.08) // lexical reranker boost
    })

    it('should attempt to load cross-encoder on first search when not loaded', async () => {
      mockIsRerankerReady.mockReturnValue(false)
      const fakeEmbedding = Array(384).fill(0.1)
      mockEmbed.mockResolvedValue(fakeEmbedding)
      mockSearchHybrid.mockResolvedValue([
        {
          chunkId: 'c-1',
          documentId: 'd-1',
          documentName: 'doc.txt',
          text: 'alpha beta',
          searchText: 'alpha beta',
          sectionPath: [],
          headingText: '',
          score: 0.8,
          chunkIndex: 0,
        },
      ])

      await search('alpha beta', 'lib-1')

      // Should attempt to load (non-blocking)
      expect(mockLoadRerankerModel).toHaveBeenCalled()
    })

    it('should not block search if cross-encoder load fails', async () => {
      mockIsRerankerReady.mockReturnValue(false)
      mockLoadRerankerModel.mockRejectedValue(new Error('Load failed'))
      const fakeEmbedding = Array(384).fill(0.1)
      mockEmbed.mockResolvedValue(fakeEmbedding)
      mockSearchHybrid.mockResolvedValue([
        {
          chunkId: 'c-1',
          documentId: 'd-1',
          documentName: 'doc.txt',
          text: 'alpha beta',
          searchText: 'alpha beta',
          sectionPath: [],
          headingText: '',
          score: 0.8,
          chunkIndex: 0,
        },
      ])

      // Should not throw, should return results
      const results = await search('alpha beta', 'lib-1')
      expect(results).toHaveLength(1)
    })
  })

  describe('reranking integration', () => {
    it('should reorder results based on query-term coverage (lexical reranker)', async () => {
      const fakeEmbedding = Array(384).fill(0.1)
      mockEmbed.mockResolvedValue(fakeEmbedding)
      // c-1 has higher Orama score but no query terms; c-2 has lower Orama score but all query terms
      mockSearchHybrid.mockResolvedValue([
        {
          chunkId: 'c-1',
          documentId: 'd-1',
          documentName: 'doc.txt',
          text: 'unrelated content',
          searchText: 'unrelated content',
          sectionPath: [],
          headingText: '',
          score: 0.9,
          chunkIndex: 0,
        },
        {
          chunkId: 'c-2',
          documentId: 'd-1',
          documentName: 'doc.txt',
          text: 'alpha beta gamma',
          searchText: 'alpha beta gamma',
          sectionPath: [],
          headingText: '',
          score: 0.85,
          chunkIndex: 1,
        },
      ])

      const results = await search('alpha beta gamma', 'lib-1')

      // c-2 should be first because it has full query-term coverage
      expect(results[0]!.chunkId).toBe('c-2')
      expect(results[0]!.rerankScore).toBeGreaterThan(results[1]!.rerankScore!)
    })

    it('should truncate to maxResults after reranking', async () => {
      const fakeEmbedding = Array(384).fill(0.1)
      mockEmbed.mockResolvedValue(fakeEmbedding)
      mockSearchHybrid.mockResolvedValue([
        {
          chunkId: 'c-1',
          documentId: 'd-1',
          documentName: 'doc.txt',
          text: 'alpha content',
          searchText: 'alpha content',
          sectionPath: [],
          headingText: '',
          score: 0.9,
          chunkIndex: 0,
        },
        {
          chunkId: 'c-2',
          documentId: 'd-1',
          documentName: 'doc.txt',
          text: 'alpha more',
          searchText: 'alpha more',
          sectionPath: [],
          headingText: '',
          score: 0.88,
          chunkIndex: 1,
        },
        {
          chunkId: 'c-3',
          documentId: 'd-1',
          documentName: 'doc.txt',
          text: 'alpha extra',
          searchText: 'alpha extra',
          sectionPath: [],
          headingText: '',
          score: 0.85,
          chunkIndex: 2,
        },
      ])

      const results = await search('alpha', 'lib-1', 2)

      expect(results).toHaveLength(2)
    })

    it('should preserve original Orama score and add rerankScore', async () => {
      const fakeEmbedding = Array(384).fill(0.1)
      mockEmbed.mockResolvedValue(fakeEmbedding)
      mockSearchHybrid.mockResolvedValue([
        {
          chunkId: 'c-1',
          documentId: 'd-1',
          documentName: 'doc.txt',
          text: 'alpha beta',
          searchText: 'alpha beta',
          sectionPath: [],
          headingText: '',
          score: 0.8,
          chunkIndex: 0,
        },
      ])

      const results = await search('alpha beta', 'lib-1')

      expect(results[0]!.score).toBe(0.8) // original Orama score preserved
      expect(results[0]!.rerankScore).toBeDefined()
      expect(results[0]!.rerankScore).toBeGreaterThan(0.8) // boosted by coverage + phrase
    })
  })

  describe('empty-chunk guard', () => {
    it('should drop candidates with empty text before reranking', async () => {
      const fakeEmbedding = Array(384).fill(0.1)
      mockEmbed.mockResolvedValue(fakeEmbedding)
      mockSearchHybrid.mockResolvedValue([
        {
          chunkId: 'c-empty',
          documentId: 'd-1',
          documentName: 'doc.txt',
          text: '',
          searchText: 'alpha beta gamma',
          sectionPath: [],
          headingText: '',
          score: 0.95,
          chunkIndex: 0,
        },
        {
          chunkId: 'c-valid',
          documentId: 'd-1',
          documentName: 'doc.txt',
          text: 'alpha beta gamma content',
          searchText: 'alpha beta gamma content',
          sectionPath: [],
          headingText: '',
          score: 0.8,
          chunkIndex: 1,
        },
      ])

      const results = await search('alpha beta gamma', 'lib-1')

      expect(results).toHaveLength(1)
      expect(results[0]!.chunkId).toBe('c-valid')
    })

    it('should return empty when all candidates are empty-text chunks', async () => {
      const fakeEmbedding = Array(384).fill(0.1)
      mockEmbed.mockResolvedValue(fakeEmbedding)
      mockSearchHybrid.mockResolvedValue([
        {
          chunkId: 'c-empty-1',
          documentId: 'd-1',
          documentName: 'doc.txt',
          text: '',
          searchText: '',
          sectionPath: [],
          headingText: '',
          score: 0.95,
          chunkIndex: 0,
        },
        {
          chunkId: 'c-empty-2',
          documentId: 'd-1',
          documentName: 'doc.txt',
          text: '   ',
          searchText: '   ',
          sectionPath: [],
          headingText: '',
          score: 0.9,
          chunkIndex: 1,
        },
      ])

      const results = await search('alpha beta gamma', 'lib-1')

      expect(results).toHaveLength(0)
    })
  })
})
