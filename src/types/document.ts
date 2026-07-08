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
  text: string
  embedding: number[]
  /** Immediate heading of the section this chunk belongs to (e.g. "Discography") */
  headingText: string
  /** Full breadcrumb of ancestor headings, root → leaf (e.g. ["Britney Spears", "Life and career", "Discography"]) */
  sectionPath: string[]
}

export type DocumentContent = {
  documentId: string
  libraryId: string
  text: string
}
