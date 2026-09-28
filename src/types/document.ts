export type DocumentStatus =
  | 'pending'
  | 'parsing'
  | 'chunking'
  | 'embedding'
  | 'indexed'
  | 'error'

export type DocumentMeta = {
  id: string
  libraryId: string
  name: string
  type: 'pdf' | 'docx' | 'txt' | 'md'
  size: number
  createdAt: number
  updatedAt: number
  status: DocumentStatus
  chunkCount: number
  processingProgress?: number // 0-100, only present when status is processing
  error?: string
}

export type Chunk = {
  id: string
  libraryId: string
  documentId: string
  documentName: string
  chunkIndex: number
  /** Sanitized Markdown text for display and highlighting */
  text: string
  /** Plain text representation for retrieval (no Markdown syntax) */
  searchText: string
  /** Heading hierarchy path (e.g. ["Introduction", "Methods"]) */
  sectionPath: string[]
  /** Immediate parent heading text */
  headingText: string
  embedding: number[]
  /**
   * Start offset of chunk's content proper in the original document text.
   * Excludes the overlap prefix (overlap is shared with previous chunk).
   * For multi-block chunks, this is the start of the first content block.
   * Undefined for plain-text chunking (chunkText) which has no AST positions.
   */
  sourceStart?: number
  /**
   * End offset of chunk's content proper in the original document text.
   * Excludes the overlap prefix. For multi-block chunks, this is the end of
   * the last content block. The range [sourceStart, sourceEnd] may include
   * inter-block whitespace that differs from the chunk's text.
   * Undefined for plain-text chunking (chunkText).
   */
  sourceEnd?: number
}

export type DocumentContent = {
  documentId: string
  libraryId: string
  text: string
}
