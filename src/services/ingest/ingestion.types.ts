import type { ContentFormat } from '@/types/document'

/**
 * Result of parsing a source file through its source adapter.
 * The `format` determines which downstream route (markdown/text) the content takes.
 */
export interface ParsedContent {
  /** Extracted text content */
  text: string
  /** Canonical downstream format chosen by the source adapter */
  format: ContentFormat
}

/**
 * Chunk data produced by a format-specific chunker.
 * Shared shape for both markdown and text chunkers.
 */
export interface ChunkData {
  /** Normalized text for display and highlighting */
  text: string
  /** Plain text for retrieval (BM25 indexing). May equal `text` when already plain. */
  searchText: string
  /** Heading hierarchy path (e.g. ["Introduction", "Methods"]) */
  sectionPath: string[]
  /** Immediate parent heading text */
  headingText: string
  chunkIndex: number
  /**
   * Start offset of chunk's content proper in the normalized document body.
   * Excludes the overlap prefix. Undefined for plain-text chunking without offsets.
   */
  sourceStart?: number
  /**
   * End offset of chunk's content proper in the normalized document body.
   * Excludes the overlap prefix. Undefined for plain-text chunking without offsets.
   */
  sourceEnd?: number
}
