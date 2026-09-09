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
}

export type DocumentContent = {
  documentId: string
  libraryId: string
  text: string
}
