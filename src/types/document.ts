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
  page?: number
}

export type DocumentContent = {
  documentId: string
  libraryId: string
  text: string
  pages?: string[]
}
