import { proxy } from 'comlink'
import { getEmbeddingWorker } from '@/infrastructure/worker-pool'
import type {
  EmbeddingModelStatus,
  EmbeddingProgressCallback,
  EmbeddingLoadProgressCallback,
} from '@/workers/embedding.worker'

/** Initializes the embedding model in the worker, reporting download progress (0..1) */
export async function initEmbeddingModel(
  onProgress?: EmbeddingLoadProgressCallback,
): Promise<void> {
  const worker = getEmbeddingWorker()
  await worker.loadModel(onProgress ? proxy(onProgress) : undefined)
}

/** Returns the current status of the embedding model */
export async function getEmbeddingModelStatus(): Promise<EmbeddingModelStatus> {
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
  onProgress?: EmbeddingProgressCallback,
): Promise<number[][]> {
  const worker = getEmbeddingWorker()
  return worker.generateEmbeddings(
    texts,
    onProgress ? proxy(onProgress) : undefined,
  )
}
