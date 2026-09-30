import { describe, it, expect, vi, beforeEach } from 'vitest'
import { search, SearchModelNotReadyError } from './search.service'
import { RERANK_CANDIDATES_CROSS_ENCODER } from '@/lib/constants'

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
  isRerankerReady: vi.fn(() => true),
  loadRerankerModel: vi.fn(() => Promise.resolve(true)),
  isRerankerDegraded: vi.fn(() => false),
  resetRerankerLoadState: vi.fn(),
}))

import { embed } from '@/services/embedding/embedding.service'
import { searchHybrid } from '@/services/embedding/vector-store'
import {
  rerankWithCrossEncoder,
  isRerankerReady,
} from './cross-encoder-reranker.service'

const mockEmbed = vi.mocked(embed)
const mockSearchHybrid = vi.mocked(searchHybrid)
const mockRerankWithCrossEncoder = vi.mocked(rerankWithCrossEncoder)
const mockIsRerankerReady = vi.mocked(isRerankerReady)

describe('search.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: cross-encoder ready
    mockIsRerankerReady.mockReturnValue(true)
  })

  describe('empty query handling', () => {
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
  })

  describe('cross-encoder gate', () => {
    it('should throw SearchModelNotReadyError when cross-encoder is not ready', async () => {
      mockIsRerankerReady.mockReturnValue(false)
      await expect(search('test', 'lib-1')).rejects.toThrow(SearchModelNotReadyError)
      await expect(search('test', 'lib-1')).rejects.toThrow(/Cross-encoder model is not ready/)
      // Embedding should not even be called — gate fires first
      expect(mockEmbed).not.toHaveBeenCalled()
    })

    it('should not call searchHybrid when cross-encoder is not ready', async () => {
      mockIsRerankerReady.mockReturnValue(false)
      await expect(search('test', 'lib-1')).rejects.toThrow()
      expect(mockSearchHybrid).not.toHaveBeenCalled()
    })
  })

  describe('pipeline (cross-encoder ready)', () => {
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
      mockRerankWithCrossEncoder.mockResolvedValue([
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
          rerankScore: 5.0,
        },
      ])

      const results = await search('test query', 'lib-1')

      expect(mockEmbed).toHaveBeenCalledWith('test query')
      expect(mockSearchHybrid).toHaveBeenCalledWith(
        'lib-1',
        'test query',
        fakeEmbedding,
        RERANK_CANDIDATES_CROSS_ENCODER,
        undefined,
      )
      expect(results).toHaveLength(1)
      expect(results[0]!.documentName).toBe('test.pdf')
    })

    it('should request at least RERANK_CANDIDATES_CROSS_ENCODER candidates', async () => {
      const fakeEmbedding = Array(384).fill(0.1)
      mockEmbed.mockResolvedValue(fakeEmbedding)
      mockSearchHybrid.mockResolvedValue([])
      mockRerankWithCrossEncoder.mockResolvedValue([])

      await search('query', 'lib-1', 10)

      // maxResults=10 < RERANK_CANDIDATES_CROSS_ENCODER, so pool is expanded
      expect(mockSearchHybrid).toHaveBeenCalledWith(
        'lib-1',
        'query',
        fakeEmbedding,
        RERANK_CANDIDATES_CROSS_ENCODER,
        undefined,
      )
    })

    it('should request maxResults when it exceeds RERANK_CANDIDATES_CROSS_ENCODER', async () => {
      const fakeEmbedding = Array(384).fill(0.1)
      mockEmbed.mockResolvedValue(fakeEmbedding)
      mockSearchHybrid.mockResolvedValue([])
      mockRerankWithCrossEncoder.mockResolvedValue([])

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
      mockRerankWithCrossEncoder.mockResolvedValue([])

      await search('  hello world  ', 'lib-1')

      expect(mockEmbed).toHaveBeenCalledWith('hello world')
      expect(mockSearchHybrid).toHaveBeenCalledWith(
        'lib-1',
        'hello world',
        fakeEmbedding,
        RERANK_CANDIDATES_CROSS_ENCODER,
        undefined,
      )
    })

    it('should pass custom weights to hybrid search', async () => {
      const fakeEmbedding = Array(384).fill(0.1)
      mockEmbed.mockResolvedValue(fakeEmbedding)
      mockSearchHybrid.mockResolvedValue([])
      mockRerankWithCrossEncoder.mockResolvedValue([])

      const customWeights = { text: 0.3, vector: 0.7 }
      await search('query', 'lib-1', undefined, customWeights)

      expect(mockSearchHybrid).toHaveBeenCalledWith(
        'lib-1',
        'query',
        fakeEmbedding,
        RERANK_CANDIDATES_CROSS_ENCODER,
        customWeights,
      )
    })

    it('should use cross-encoder reranking directly on candidates', async () => {
      const fakeEmbedding = Array(384).fill(0.1)
      mockEmbed.mockResolvedValue(fakeEmbedding)
      const hybridResults = [
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
      ]
      mockSearchHybrid.mockResolvedValue(hybridResults)

      // Cross-encoder reorders and assigns logits
      mockRerankWithCrossEncoder.mockResolvedValue([
        {
          ...hybridResults[0]!,
          rerankScore: 5.5,
        },
      ])

      const results = await search('alpha beta', 'lib-1')

      expect(mockRerankWithCrossEncoder).toHaveBeenCalledWith('alpha beta', expect.any(Array))
      expect(results).toHaveLength(1)
      expect(results[0]!.rerankScore).toBe(5.5)
    })
  })

  describe('abstention by cross-encoder logit threshold (-6.0)', () => {
    it('should abstain when all cross-encoder logits are below -6.0', async () => {
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

      // Cross-encoder returns low logit (irrelevant)
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
          rerankScore: -7.0, // below -6.0 threshold
        },
      ])

      const results = await search('alpha beta gamma', 'lib-1')
      expect(results).toHaveLength(0)
    })

    it('should NOT abstain when at least one result has logit >= -6.0', async () => {
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
      // c-1 has logit 5.0 >= -6.0 → no abstention
      expect(results).toHaveLength(2)
    })

    it('should abstain when logit is exactly at boundary (-6.0 passes, -6.01 does not)', async () => {
      const fakeEmbedding = Array(384).fill(0.1)
      mockEmbed.mockResolvedValue(fakeEmbedding)
      mockSearchHybrid.mockResolvedValue([
        {
          chunkId: 'c-1',
          documentId: 'd-1',
          documentName: 'doc.txt',
          text: 'content',
          searchText: 'content',
          sectionPath: [],
          headingText: '',
          score: 0.9,
          chunkIndex: 0,
        },
      ])

      // Exactly at threshold → passes
      mockRerankWithCrossEncoder.mockResolvedValue([
        {
          chunkId: 'c-1',
          documentId: 'd-1',
          documentName: 'doc.txt',
          text: 'content',
          searchText: 'content',
          sectionPath: [],
          headingText: '',
          score: 0.9,
          chunkIndex: 0,
          rerankScore: -6.0,
        },
      ])
      const resultsAt = await search('query', 'lib-1')
      expect(resultsAt).toHaveLength(1)

      // Just below threshold → abstains
      mockRerankWithCrossEncoder.mockResolvedValue([
        {
          chunkId: 'c-1',
          documentId: 'd-1',
          documentName: 'doc.txt',
          text: 'content',
          searchText: 'content',
          sectionPath: [],
          headingText: '',
          score: 0.9,
          chunkIndex: 0,
          rerankScore: -6.01,
        },
      ])
      const resultsBelow = await search('query', 'lib-1')
      expect(resultsBelow).toHaveLength(0)
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

      mockRerankWithCrossEncoder.mockResolvedValue([
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
          rerankScore: 5.0,
        },
      ])

      const results = await search('alpha beta gamma', 'lib-1')

      expect(results).toHaveLength(1)
      expect(results[0]!.chunkId).toBe('c-valid')
      // Cross-encoder should only receive the valid candidate
      expect(mockRerankWithCrossEncoder).toHaveBeenCalledWith(
        'alpha beta gamma',
        expect.arrayContaining([expect.objectContaining({ chunkId: 'c-valid' })]),
      )
      expect(mockRerankWithCrossEncoder).toHaveBeenCalledWith(
        'alpha beta gamma',
        expect.not.arrayContaining([expect.objectContaining({ chunkId: 'c-empty' })]),
      )
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
      expect(mockRerankWithCrossEncoder).not.toHaveBeenCalled()
    })
  })

  describe('truncation', () => {
    it('should truncate to maxResults after cross-encoder reranking', async () => {
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

      mockRerankWithCrossEncoder.mockResolvedValue([
        { chunkId: 'c-1', documentId: 'd-1', documentName: 'doc.txt', text: 'alpha content', searchText: 'alpha content', sectionPath: [], headingText: '', score: 0.9, chunkIndex: 0, rerankScore: 5.0 },
        { chunkId: 'c-2', documentId: 'd-1', documentName: 'doc.txt', text: 'alpha more', searchText: 'alpha more', sectionPath: [], headingText: '', score: 0.88, chunkIndex: 1, rerankScore: 4.0 },
        { chunkId: 'c-3', documentId: 'd-1', documentName: 'doc.txt', text: 'alpha extra', searchText: 'alpha extra', sectionPath: [], headingText: '', score: 0.85, chunkIndex: 2, rerankScore: 3.0 },
      ])

      const results = await search('alpha', 'lib-1', 2)
      expect(results).toHaveLength(2)
    })
  })
})
