import type { Library } from './library'
import type { DocumentMeta } from './document'

/**
 * Serializable snapshot of a library's corpus for offline diagnostic use.
 *
 * Produced by `corpus-export.service.ts` from the live Dexie database and
 * consumed by benchmark tests and the dev console. The shape is intentionally
 * decoupled from Dexie so fixtures can be committed to the repo or shared
 * without requiring IndexedDB.
 *
 * Embeddings are stored in a separate optional section (`embeddings`) because
 * they are large (N × 384 floats) and most diagnostic workflows only need the
 * text content. Set `includeEmbeddings: false` when exporting to omit them.
 */
export type CorpusFixture = {
  /** Schema version — bump when the shape changes incompatibly */
  version: 1
  /** ISO-8601 timestamp of when the export was created */
  exportedAt: string
  /** Library metadata (id, name, counts) */
  library: Pick<
    Library,
    'id' | 'name' | 'description' | 'documentCount' | 'chunkCount'
  >
  /** Per-document content and chunks */
  documents: CorpusFixtureDocument[]
  /**
   * Embeddings stored separately from chunks so the fixture can be stripped
   * down for text-only diagnostics. Present only when exported with
   * `includeEmbeddings: true`.
   */
  embeddings?: CorpusFixtureEmbedding[]
}

export type CorpusFixtureDocument = {
  /** Document metadata (all fields from DocumentMeta) */
  meta: DocumentMeta
  /**
   * The full filtered text that was saved by `saveDocumentContent` during
   * ingestion. This is the input to the chunking pipeline — re-chunking this
   * text should reproduce the chunks below (modulo chunking strategy changes).
   */
  content: string
  /** Chunks derived from this document at ingestion time */
  chunks: CorpusFixtureChunk[]
}

export type CorpusFixtureChunk = {
  /** Positional index within the document (0-based) */
  chunkIndex: number
  /** Sanitized Markdown text for display and highlighting */
  text: string
  /** Plain text representation for retrieval (no Markdown syntax) */
  searchText: string
  /** Heading hierarchy path (e.g. ["Introduction", "Methods"]) */
  sectionPath: string[]
  /** Immediate parent heading text */
  headingText: string
}

export type CorpusFixtureEmbedding = {
  /** References the parent document */
  documentId: string
  /** Positional index within the document — together with documentId forms a unique key */
  chunkIndex: number
  /** The embedding vector (typically 384 floats) */
  embedding: number[]
}
