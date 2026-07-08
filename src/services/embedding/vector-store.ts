import { create, insert, search, remove, type AnyOrama } from '@orama/orama'
import type { Chunk } from '@/types/document'
import type { HybridWeights } from '@/types/search'
import { EMBEDDING_DIMENSIONS, DEFAULT_MAX_RESULTS } from '@/lib/constants'

export interface VectorSearchResult {
  chunkId: string
  documentId: string
  documentName: string
  text: string
  score: number
  chunkIndex: number
  headingText: string
  sectionPath: string[]
}

/**
 * BM25 field boosts. `headingText` gets the strongest signal since an exact
 * match with a section heading is nearly always the most relevant chunk in that
 * section. `sectionPath` gets a smaller boost so ancestor-heading matches still
 * surface (e.g., searching "Discography" while the immediate heading is a
 * subsection like "Studio albums").
 */
const SEARCH_BOOST = { headingText: 3, sectionPath: 1.5, text: 1 } as const

const indexes = new Map<string, AnyOrama>()

/** Creates a new Orama vector index for a library */
async function createIndex(libraryId: string): Promise<AnyOrama> {
  const index = await create({
    schema: {
      chunkId: 'string',
      documentId: 'string',
      documentName: 'string',
      text: 'string',
      headingText: 'string',
      sectionPath: 'string[]',
      embedding: `vector[${EMBEDDING_DIMENSIONS}]`,
      chunkIndex: 'number',
    } as const,
  })
  indexes.set(libraryId, index)
  return index
}

/** Retrieves existing index or creates a new one for a library */
export async function getOrCreateIndex(libraryId: string): Promise<AnyOrama> {
  const existing = indexes.get(libraryId)
  if (existing) return existing
  return createIndex(libraryId)
}

/** Inserts chunks into a library's vector index */
export async function insertChunks(
  libraryId: string,
  chunks: Chunk[],
): Promise<void> {
  const index = await getOrCreateIndex(libraryId)
  for (const chunk of chunks) {
    await insert(index, {
      chunkId: chunk.id,
      documentId: chunk.documentId,
      documentName: chunk.documentName,
      text: chunk.text,
      headingText: chunk.headingText,
      sectionPath: chunk.sectionPath,
      embedding: chunk.embedding,
      chunkIndex: chunk.chunkIndex,
    })
  }
}

/** Performs hybrid search (BM25 + vector) within a library's index */
export async function searchHybrid(
  libraryId: string,
  term: string,
  embedding: number[],
  topK?: number,
  weights?: HybridWeights,
): Promise<VectorSearchResult[]> {
  const index = indexes.get(libraryId)
  if (!index) return []

  const results = await search(index, {
    mode: 'hybrid',
    term,
    vector: { value: embedding, property: 'embedding' },
    properties: ['text', 'headingText', 'sectionPath'],
    boost: SEARCH_BOOST,
    limit: topK ?? DEFAULT_MAX_RESULTS,
    includeVectors: false,
    similarity: 0.0,
    hybridWeights: weights ?? { text: 0.5, vector: 0.5 },
  })

  return results.hits.map((hit) => ({
    chunkId: hit.document.chunkId as string,
    documentId: hit.document.documentId as string,
    documentName: hit.document.documentName as string,
    text: hit.document.text as string,
    score: hit.score,
    chunkIndex: hit.document.chunkIndex as number,
    headingText: (hit.document.headingText as string) ?? '',
    sectionPath: (hit.document.sectionPath as string[]) ?? [],
  }))
}

/** Performs vector similarity search within a library's index */
export async function searchByVector(
  libraryId: string,
  embedding: number[],
  topK?: number,
): Promise<VectorSearchResult[]> {
  const index = indexes.get(libraryId)
  if (!index) return []

  const results = await search(index, {
    mode: 'vector',
    vector: { value: embedding, property: 'embedding' },
    limit: topK ?? DEFAULT_MAX_RESULTS,
    includeVectors: false,
    similarity: 0.0,
  })

  return results.hits.map((hit) => ({
    chunkId: hit.document.chunkId as string,
    documentId: hit.document.documentId as string,
    documentName: hit.document.documentName as string,
    text: hit.document.text as string,
    score: hit.score,
    chunkIndex: hit.document.chunkIndex as number,
    headingText: (hit.document.headingText as string) ?? '',
    sectionPath: (hit.document.sectionPath as string[]) ?? [],
  }))
}

/** Removes all chunks belonging to a specific document from the vector index */
export async function removeByDocumentId(
  libraryId: string,
  documentId: string,
): Promise<void> {
  const index = indexes.get(libraryId)
  if (!index) return

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

/** Rebuilds a library's vector index from scratch with provided chunks */
export async function rebuildIndex(
  libraryId: string,
  chunks: Chunk[],
): Promise<void> {
  indexes.delete(libraryId)
  if (chunks.length > 0) {
    await insertChunks(libraryId, chunks)
  }
}

/** Removes a library's vector index from memory */
export function removeIndex(libraryId: string): void {
  indexes.delete(libraryId)
}

/** Checks if a vector index exists for a library */
export function hasIndex(libraryId: string): boolean {
  return indexes.has(libraryId)
}
