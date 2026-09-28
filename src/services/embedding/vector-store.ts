import { create, insert, search, remove, type AnyOrama } from '@orama/orama'
import type { Chunk } from '@/types/document'
import { getChunksByLibrary } from '@/services/chunk.service'
import type { HybridWeights } from '@/types/search'
import { EMBEDDING_DIMENSIONS, DEFAULT_MAX_RESULTS, DEFAULT_HYBRID_WEIGHTS, ORAMA_LEXICAL_THRESHOLD } from '@/lib/constants'
import { ENGLISH_STOP_WORDS_ARRAY } from '@/lib/stop-words'

export interface VectorSearchResult {
  chunkId: string
  documentId: string
  documentName: string
  text: string
  searchText: string
  sectionPath: string[]
  headingText: string
  score: number
  chunkIndex: number
}

const indexes = new Map<string, AnyOrama>()

/** Creates a new Orama vector index for a library */
async function createIndex(libraryId: string): Promise<AnyOrama> {
  const index = await create({
    schema: {
      chunkId: 'string',
      documentId: 'string',
      documentName: 'string',
      text: 'string',
      searchText: 'string',
      sectionPath: 'string[]',
      headingText: 'string',
      embedding: `vector[${EMBEDDING_DIMENSIONS}]`,
      chunkIndex: 'number',
    } as const,
    components: {
      tokenizer: {
        language: 'english',
        stemming: true,
        stopWords: ENGLISH_STOP_WORDS_ARRAY,
      },
    },
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
      searchText: chunk.searchText,
      sectionPath: chunk.sectionPath,
      headingText: chunk.headingText,
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
    properties: ['searchText', 'headingText'],
    limit: topK ?? DEFAULT_MAX_RESULTS,
    includeVectors: false,
    similarity: 0.0,
    // CAVEAT: Orama's search-hybrid.js checks `hybridWeights.text && hybridWeights.vector`
    // with truthiness — a component of 0 silently discards the weights and falls back
    // to 0.5/0.5. Never pass a zero component. See DEFAULT_HYBRID_WEIGHTS JSDoc.
    hybridWeights: weights ?? DEFAULT_HYBRID_WEIGHTS,
    threshold: ORAMA_LEXICAL_THRESHOLD,
  })

  return results.hits.map((hit) => ({
    chunkId: hit.document.chunkId as string,
    documentId: hit.document.documentId as string,
    documentName: hit.document.documentName as string,
    text: hit.document.text as string,
    searchText: hit.document.searchText as string,
    sectionPath: (hit.document.sectionPath as string[]) ?? [],
    headingText: (hit.document.headingText as string) ?? '',
    score: hit.score,
    chunkIndex: hit.document.chunkIndex as number,
  }))
}

/**
 * Performs BM25 fulltext search within a library's index.
 *
 * Returns the same `VectorSearchResult` shape as `searchHybrid` and
 * `searchByVector` so callers can union/fuse the candidate lists without
 * mapping. The `score` is Orama's BM25 score (unbounded, typically > 0).
 *
 * Used by the fused-candidate retrieval experiment to obtain an independent
 * lexical candidate pool separate from the hybrid or vector paths.
 */
export async function searchByText(
  libraryId: string,
  term: string,
  topK?: number,
): Promise<VectorSearchResult[]> {
  const index = indexes.get(libraryId)
  if (!index) return []

  const results = await search(index, {
    mode: 'fulltext',
    term,
    properties: ['searchText', 'headingText'],
    limit: topK ?? DEFAULT_MAX_RESULTS,
    threshold: ORAMA_LEXICAL_THRESHOLD,
  })

  return results.hits.map((hit) => ({
    chunkId: hit.document.chunkId as string,
    documentId: hit.document.documentId as string,
    documentName: hit.document.documentName as string,
    text: hit.document.text as string,
    searchText: hit.document.searchText as string,
    sectionPath: (hit.document.sectionPath as string[]) ?? [],
    headingText: (hit.document.headingText as string) ?? '',
    score: hit.score,
    chunkIndex: hit.document.chunkIndex as number,
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
    searchText: hit.document.searchText as string,
    sectionPath: (hit.document.sectionPath as string[]) ?? [],
    headingText: (hit.document.headingText as string) ?? '',
    score: hit.score,
    chunkIndex: hit.document.chunkIndex as number,
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

/**
 * Ensures the in-memory Orama vector index exists for a library.
 * Orama is lost on page reload; this rebuilds it from IndexedDB chunks.
 * No-op if the index is already populated (e.g. after ingest).
 */
export async function ensureIndex(libraryId: string): Promise<void> {
  if (hasIndex(libraryId)) return
  const chunks = await getChunksByLibrary(libraryId)
  if (chunks.length > 0) {
    await rebuildIndex(libraryId, chunks)
  }
}
