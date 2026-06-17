import { create, insert, search, remove, type AnyOrama } from '@orama/orama'
import type { Chunk } from '@/types/document'
import { EMBEDDING_DIMENSIONS, DEFAULT_TOP_K } from '@/lib/constants'

export interface VectorSearchResult {
  chunkId: string
  documentId: string
  documentName: string
  text: string
  score: number
  page?: number
  chunkIndex: number
}

const indexes = new Map<string, AnyOrama>()

async function createIndex(libraryId: string): Promise<AnyOrama> {
  const index = await create({
    schema: {
      chunkId: 'string',
      documentId: 'string',
      documentName: 'string',
      text: 'string',
      embedding: `vector[${EMBEDDING_DIMENSIONS}]`,
      page: 'number',
      chunkIndex: 'number',
    } as const,
  })
  indexes.set(libraryId, index)
  return index
}

export async function getOrCreateIndex(libraryId: string): Promise<AnyOrama> {
  const existing = indexes.get(libraryId)
  if (existing) return existing
  return createIndex(libraryId)
}

export async function insertChunks(libraryId: string, chunks: Chunk[]): Promise<void> {
  const index = await getOrCreateIndex(libraryId)
  for (const chunk of chunks) {
    await insert(index, {
      chunkId: chunk.id,
      documentId: chunk.documentId,
      documentName: chunk.documentName,
      text: chunk.text,
      embedding: chunk.embedding,
      page: chunk.page ?? 0,
      chunkIndex: chunk.chunkIndex,
    })
  }
}

export async function searchByVector(
  libraryId: string,
  embedding: number[],
  topK?: number
): Promise<VectorSearchResult[]> {
  const index = indexes.get(libraryId)
  if (!index) return []

  const results = await search(index, {
    mode: 'vector',
    vector: { value: embedding, property: 'embedding' },
    limit: topK ?? DEFAULT_TOP_K,
    includeVectors: false,
    similarity: 0.0,
  })

  return results.hits.map((hit) => {
    const page = hit.document.page as number
    return {
      chunkId: hit.document.chunkId as string,
      documentId: hit.document.documentId as string,
      documentName: hit.document.documentName as string,
      text: hit.document.text as string,
      score: hit.score,
      page: page === 0 ? undefined : page,
      chunkIndex: hit.document.chunkIndex as number,
    }
  })
}

export async function removeByDocumentId(libraryId: string, documentId: string): Promise<void> {
  const index = indexes.get(libraryId)
  if (!index) return

  // Buscar y eliminar todos los chunks del documento
  const results = await search(index, {
    mode: 'fulltext',
    term: documentId,
    properties: ['documentId'],
    limit: 10000,
  })

  for (const hit of results.hits) {
    await remove(index, hit.id)
  }
}

export async function rebuildIndex(libraryId: string, chunks: Chunk[]): Promise<void> {
  // Eliminar índice existente y recrear
  indexes.delete(libraryId)
  if (chunks.length > 0) {
    await insertChunks(libraryId, chunks)
  }
}

export function removeIndex(libraryId: string): void {
  indexes.delete(libraryId)
}

export function hasIndex(libraryId: string): boolean {
  return indexes.has(libraryId)
}
