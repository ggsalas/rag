import { proxy } from 'comlink'
import { getEmbeddingWorker } from '@/infrastructure/worker-pool'
import type { EmbeddingModelStatus, EmbeddingProgressCallback } from '@/workers/embedding.worker'

/** Initializes the embedding model in the worker */
export async function initModel(): Promise<void> {
  const worker = getEmbeddingWorker()
  await worker.loadModel()
}

/** Returns the current status of the embedding model */
export async function getModelStatus(): Promise<EmbeddingModelStatus> {
  const worker = getEmbeddingWorker()
  return worker.getStatus()
}

/** Generates an embedding vector for a single text string */
export async function embed(text: string): Promise<number[]> {
  const worker = getEmbeddingWorker()
  return worker.generateEmbedding(text)
}

/** Generates embedding vectors for multiple texts with optional progress tracking */
export async function embedBatch(
  texts: string[],
  onProgress?: EmbeddingProgressCallback
): Promise<number[][]> {
  const worker = getEmbeddingWorker()
  return worker.generateEmbeddings(texts, onProgress ? proxy(onProgress) : undefined)
}
