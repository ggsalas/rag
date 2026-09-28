import { db } from '@/infrastructure/db'
import type {
  CorpusFixture,
  CorpusFixtureDocument,
  CorpusFixtureChunk,
  CorpusFixtureEmbedding,
} from '@/types/corpus-fixture'

export type ExportCorpusOptions = {
  /**
   * When true (default), embeddings are included in a separate `embeddings`
   * section of the output. Set to false for a lightweight text-only fixture.
   */
  includeEmbeddings?: boolean
}

/**
 * Exports the full corpus of a library as a serializable JSON object.
 *
 * Reads from Dexie: library metadata, document metadata, document content
 * (the filtered text saved during ingestion), chunks, and optionally
 * embeddings. The result can be serialized with `JSON.stringify` and saved
 * to disk for offline diagnostic use (benchmark re-runs, A/B chunking
 * comparisons, etc.).
 *
 * Does NOT modify any data. Does NOT touch Orama or any in-memory index.
 */
export async function exportLibraryCorpus(
  libraryId: string,
  options: ExportCorpusOptions = {},
): Promise<CorpusFixture> {
  const { includeEmbeddings = true } = options

  const library = await db.libraries.get(libraryId)
  if (!library) {
    throw new Error(`Library not found: ${libraryId}`)
  }

  const documents = await db.documents
    .where('libraryId')
    .equals(libraryId)
    .sortBy('createdAt')

  const fixtureDocuments: CorpusFixtureDocument[] = []
  const fixtureEmbeddings: CorpusFixtureEmbedding[] = []

  for (const doc of documents) {
    const content = await db.documentContents.get(doc.id)
    const chunks = await db.chunks
      .where('[libraryId+documentId]')
      .equals([libraryId, doc.id])
      .sortBy('chunkIndex')

    const fixtureChunks: CorpusFixtureChunk[] = chunks.map((c) => ({
      chunkIndex: c.chunkIndex,
      text: c.text,
      searchText: c.searchText,
      sectionPath: c.sectionPath,
      headingText: c.headingText,
    }))

    fixtureDocuments.push({
      meta: doc,
      content: content?.text ?? '',
      chunks: fixtureChunks,
    })

    if (includeEmbeddings) {
      for (const c of chunks) {
        fixtureEmbeddings.push({
          documentId: c.documentId,
          chunkIndex: c.chunkIndex,
          embedding: c.embedding,
        })
      }
    }
  }

  const fixture: CorpusFixture = {
    version: 1,
    exportedAt: new Date().toISOString(),
    library: {
      id: library.id,
      name: library.name,
      description: library.description,
      documentCount: library.documentCount,
      chunkCount: library.chunkCount,
    },
    documents: fixtureDocuments,
  }

  if (includeEmbeddings && fixtureEmbeddings.length > 0) {
    fixture.embeddings = fixtureEmbeddings
  }

  return fixture
}

/**
 * Validates that a parsed JSON object conforms to the CorpusFixture shape.
 *
 * Performs structural checks (version, required fields, array types) but does
 * NOT deep-validate every chunk field — it trusts the exporter. Returns a
 * human-readable error message on failure, or null on success.
 */
export function validateCorpusFixture(
  data: unknown,
): string | null {
  if (!data || typeof data !== 'object') return 'Fixture is not an object'
  const obj = data as Record<string, unknown>

  if (obj.version !== 1) return `Unsupported fixture version: ${obj.version}`
  if (typeof obj.exportedAt !== 'string') return 'Missing exportedAt'
  if (!obj.library || typeof obj.library !== 'object') return 'Missing library'
  if (!Array.isArray(obj.documents)) return 'Missing documents array'

  for (let i = 0; i < obj.documents.length; i++) {
    const doc = obj.documents[i] as Record<string, unknown>
    if (!doc || typeof doc !== 'object') return `documents[${i}] is not an object`
    if (!doc.meta || typeof doc.meta !== 'object')
      return `documents[${i}].meta is missing`
    if (typeof doc.content !== 'string')
      return `documents[${i}].content is not a string`
    if (!Array.isArray(doc.chunks))
      return `documents[${i}].chunks is not an array`
  }

  if (obj.embeddings !== undefined) {
    if (!Array.isArray(obj.embeddings)) return 'embeddings is not an array'
    for (let i = 0; i < obj.embeddings.length; i++) {
      const emb = obj.embeddings[i] as Record<string, unknown>
      if (!emb || typeof emb !== 'object')
        return `embeddings[${i}] is not an object`
      if (typeof emb.documentId !== 'string')
        return `embeddings[${i}].documentId is missing`
      if (typeof emb.chunkIndex !== 'number')
        return `embeddings[${i}].chunkIndex is missing`
      if (!Array.isArray(emb.embedding))
        return `embeddings[${i}].embedding is not an array`
    }
  }

  return null
}
