import { describe, it, expect, vi, beforeEach } from 'vitest'
import { search, SearchModelNotReadyError } from './search.service'
import { RERANK_CANDIDATES_CROSS_ENCODER } from '@/lib/constants'
import { RERANK_CANDIDATE_POOL } from '@/lib/lexical-ranking'

// Mock the embedding service
vi.mock('@/services/embedding/embedding.service', () => ({
  embed: vi.fn(),
}))

// Mock the vector store
vi.mock('@/services/embedding/vector-store', () => ({
  searchByVector: vi.fn(),
  searchHybrid: vi.fn(),
}))

// Mock the cross-encoder service
vi.mock('./cross-encoder.service', () => ({
  rankWithCrossEncoder: vi.fn((_query, candidates) => Promise.resolve(candidates)),
  isCrossEncoderReady: vi.fn(() => true),
  loadCrossEncoderModel: vi.fn(() => Promise.resolve(true)),
  resetCrossEncoderLoadState: vi.fn(),
}))

// Mock the lexical reranker service
vi.mock('@/lib/lexical-ranking', () => ({
  rankByLexicalRelevance: vi.fn((_query, candidates) => candidates),
  RERANK_CANDIDATE_POOL: 100,
}))

import { embed } from '@/services/embedding/embedding.service'
import { searchHybrid } from '@/services/embedding/vector-store'
import {
  rankWithCrossEncoder,
  isCrossEncoderReady,
} from './cross-encoder.service'
import { rankByLexicalRelevance } from '@/lib/lexical-ranking'

const mockEmbed = vi.mocked(embed)
const mockSearchHybrid = vi.mocked(searchHybrid)
const mockRankWithCrossEncoder = vi.mocked(rankWithCrossEncoder)
const mockIsCrossEncoderReady = vi.mocked(isCrossEncoderReady)
const mockRerank = vi.mocked(rankByLexicalRelevance)

describe('search.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: cross-encoder ready
    mockIsCrossEncoderReady.mockReturnValue(true)
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
      mockIsCrossEncoderReady.mockReturnValue(false)
      await expect(search('test', 'lib-1')).rejects.toThrow(SearchModelNotReadyError)
      await expect(search('test', 'lib-1')).rejects.toThrow(/Cross-encoder model is not ready/)
      // Embedding should not even be called — gate fires first
      expect(mockEmbed).not.toHaveBeenCalled()
    })

    it('should not call searchHybrid when cross-encoder is not ready', async () => {
      mockIsCrossEncoderReady.mockReturnValue(false)
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
      mockRankWithCrossEncoder.mockResolvedValue([
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
        RERANK_CANDIDATE_POOL,
        undefined,
      )
      expect(results).toHaveLength(1)
      expect(results[0]!.documentName).toBe('test.pdf')
    })

    it('should request at least RERANK_CANDIDATE_POOL candidates from Orama', async () => {
      const fakeEmbedding = Array(384).fill(0.1)
      mockEmbed.mockResolvedValue(fakeEmbedding)
      mockSearchHybrid.mockResolvedValue([])
      mockRankWithCrossEncoder.mockResolvedValue([])

      await search('query', 'lib-1', 10)

      // maxResults=10 < RERANK_CANDIDATE_POOL, so pool is expanded to 100
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
      mockRankWithCrossEncoder.mockResolvedValue([])

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
      mockRankWithCrossEncoder.mockResolvedValue([])

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

    it('should pass custom weights to hybrid search', async () => {
      const fakeEmbedding = Array(384).fill(0.1)
      mockEmbed.mockResolvedValue(fakeEmbedding)
      mockSearchHybrid.mockResolvedValue([])
      mockRankWithCrossEncoder.mockResolvedValue([])

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

    it('should apply lexical rerank then pass top-40 to cross-encoder', async () => {
      const fakeEmbedding = Array(384).fill(0.1)
      mockEmbed.mockResolvedValue(fakeEmbedding)

      // Build 50 hybrid results
      const hybridResults = Array.from({ length: 50 }, (_, i) => ({
        chunkId: `c-${i}`,
        documentId: 'd-1',
        documentName: 'doc.txt',
        text: `content ${i}`,
        searchText: `content ${i}`,
        sectionPath: [],
        headingText: '',
        score: 0.9 - i * 0.01,
        chunkIndex: i,
      }))
      mockSearchHybrid.mockResolvedValue(hybridResults)

      // Lexical rerank reorders: return them reversed
      const lexicallyReordered = [...hybridResults].reverse()
      mockRerank.mockReturnValue(lexicallyReordered)

      // Cross-encoder receives the top 40 from the lexically reranked list
      mockRankWithCrossEncoder.mockImplementation(async (_q, candidates) =>
        candidates.map((c) => ({ ...c, rerankScore: 5.0 })),
      )

      // Request 40 results to see all 40 from the CE pool
      const results = await search('alpha beta', 'lib-1', 40)

      // Verify lexical rerank was called with all valid candidates
      expect(mockRerank).toHaveBeenCalledWith('alpha beta', expect.any(Array))
      expect(mockRerank.mock.calls[0]![1]).toHaveLength(50)

      // Verify cross-encoder received only top 40 from the lexically reranked list
      expect(mockRankWithCrossEncoder).toHaveBeenCalledWith(
        'alpha beta',
        expect.any(Array),
      )
      const ceInput = mockRankWithCrossEncoder.mock.calls[0]![1]
      expect(ceInput).toHaveLength(RERANK_CANDIDATES_CROSS_ENCODER)
      // The first 40 of the reversed list are c-49, c-48, ..., c-10
      expect(ceInput[0]!.chunkId).toBe('c-49')
      expect(ceInput[39]!.chunkId).toBe('c-10')

      expect(results).toHaveLength(RERANK_CANDIDATES_CROSS_ENCODER)
    })

    it('should use cross-encoder reranking on lexically pre-filtered candidates', async () => {
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
      mockRerank.mockReturnValue(hybridResults)

      // Cross-encoder reorders and assigns logits
      mockRankWithCrossEncoder.mockResolvedValue([
        {
          ...hybridResults[0]!,
          rerankScore: 5.5,
        },
      ])

      const results = await search('alpha beta', 'lib-1')

      expect(mockRerank).toHaveBeenCalledWith('alpha beta', expect.any(Array))
      expect(mockRankWithCrossEncoder).toHaveBeenCalledWith('alpha beta', expect.any(Array))
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
      mockRankWithCrossEncoder.mockResolvedValue([
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

      mockRankWithCrossEncoder.mockResolvedValue([
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
      mockRankWithCrossEncoder.mockResolvedValue([
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
      mockRankWithCrossEncoder.mockResolvedValue([
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
      const hybridResults = [
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
      ]
      mockSearchHybrid.mockResolvedValue(hybridResults)

      // Lexical rerank returns the filtered candidates (only c-valid after empty-chunk filter)
      const validCandidates = hybridResults.filter((r) => r.text.trim().length > 0)
      mockRerank.mockReturnValue(validCandidates)

      mockRankWithCrossEncoder.mockResolvedValue([
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
      expect(mockRankWithCrossEncoder).toHaveBeenCalledWith(
        'alpha beta gamma',
        expect.arrayContaining([expect.objectContaining({ chunkId: 'c-valid' })]),
      )
      expect(mockRankWithCrossEncoder).toHaveBeenCalledWith(
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
      expect(mockRankWithCrossEncoder).not.toHaveBeenCalled()
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

      mockRankWithCrossEncoder.mockResolvedValue([
        { chunkId: 'c-1', documentId: 'd-1', documentName: 'doc.txt', text: 'alpha content', searchText: 'alpha content', sectionPath: [], headingText: '', score: 0.9, chunkIndex: 0, rerankScore: 5.0 },
        { chunkId: 'c-2', documentId: 'd-1', documentName: 'doc.txt', text: 'alpha more', searchText: 'alpha more', sectionPath: [], headingText: '', score: 0.88, chunkIndex: 1, rerankScore: 4.0 },
        { chunkId: 'c-3', documentId: 'd-1', documentName: 'doc.txt', text: 'alpha extra', searchText: 'alpha extra', sectionPath: [], headingText: '', score: 0.85, chunkIndex: 2, rerankScore: 3.0 },
      ])

      const results = await search('alpha', 'lib-1', 2)
      expect(results).toHaveLength(2)
    })
  })
})
