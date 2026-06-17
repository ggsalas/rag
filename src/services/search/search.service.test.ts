import { describe, it, expect, vi, beforeEach } from 'vitest'
import { search } from './search.service'

// Mock the embedding service
vi.mock('@/services/embedding/embedding.service', () => ({
  embed: vi.fn(),
}))

// Mock the vector store
vi.mock('@/services/embedding/vector-store', () => ({
  searchByVector: vi.fn(),
}))

import { embed } from '@/services/embedding/embedding.service'
import { searchByVector } from '@/services/embedding/vector-store'

const mockEmbed = vi.mocked(embed)
const mockSearchByVector = vi.mocked(searchByVector)

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

  it('should embed query and search vector store', async () => {
    const fakeEmbedding = Array(384).fill(0.1)
    mockEmbed.mockResolvedValue(fakeEmbedding)
    mockSearchByVector.mockResolvedValue([
      {
        chunkId: 'chunk-1',
        documentId: 'doc-1',
        documentName: 'test.pdf',
        text: 'sample text',
        score: 0.95,
        page: 1,
        chunkIndex: 0,
      },
    ])

    const results = await search('test query', 'lib-1')

    expect(mockEmbed).toHaveBeenCalledWith('test query')
    expect(mockSearchByVector).toHaveBeenCalledWith('lib-1', fakeEmbedding, 5)
    expect(results).toHaveLength(1)
    expect(results[0]!.documentName).toBe('test.pdf')
    expect(results[0]!.score).toBe(0.95)
  })

  it('should pass custom topK to vector store', async () => {
    const fakeEmbedding = Array(384).fill(0.1)
    mockEmbed.mockResolvedValue(fakeEmbedding)
    mockSearchByVector.mockResolvedValue([])

    await search('query', 'lib-1', 10)

    expect(mockSearchByVector).toHaveBeenCalledWith('lib-1', fakeEmbedding, 10)
  })

  it('should trim query before embedding', async () => {
    const fakeEmbedding = Array(384).fill(0.1)
    mockEmbed.mockResolvedValue(fakeEmbedding)
    mockSearchByVector.mockResolvedValue([])

    await search('  hello world  ', 'lib-1')

    expect(mockEmbed).toHaveBeenCalledWith('hello world')
  })

  it('should return results with correct SearchResult shape', async () => {
    const fakeEmbedding = Array(384).fill(0.1)
    mockEmbed.mockResolvedValue(fakeEmbedding)
    mockSearchByVector.mockResolvedValue([
      {
        chunkId: 'c-1',
        documentId: 'd-1',
        documentName: 'doc.txt',
        text: 'some text',
        score: 0.8,
        page: undefined,
        chunkIndex: 2,
      },
    ])

    const results = await search('query', 'lib-1')

    expect(results[0]).toEqual({
      chunkId: 'c-1',
      documentId: 'd-1',
      documentName: 'doc.txt',
      text: 'some text',
      score: 0.8,
      page: undefined,
      chunkIndex: 2,
    })
  })
})
