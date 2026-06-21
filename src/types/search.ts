export type SearchQuery = {
  text: string
  topK: number
}

export type HybridWeights = {
  text: number
  vector: number
}

export type SearchResult = {
  chunkId: string
  documentId: string
  documentName: string
  text: string
  score: number
  page?: number
  chunkIndex: number
}
