export type SearchPreferences = {
  maxResults: number
  llmMaxTokens?: number
  isAiMode?: boolean
}

export type Library = {
  id: string
  name: string
  description?: string
  createdAt: number
  updatedAt: number
  documentCount: number
  chunkCount: number
  searchPreferences?: SearchPreferences
}
