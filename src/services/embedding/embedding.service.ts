import { proxy } from 'comlink'
import { getEmbeddingWorker } from '@/infrastructure/worker-pool'
import type {
  EmbeddingModelStatus,
  EmbeddingProgressCallback,
  EmbeddingRole,
} from '@/workers/embedding.worker'

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

/**
 * Generates an embedding vector for a search query. Callers embedding indexed
 * document passages should use `embedPassages` instead — the two use different
 * role prefixes required by the E5 embedding model.
 */
export async function embed(text: string): Promise<number[]> {
  const worker = getEmbeddingWorker()
  return worker.generateEmbedding(text, 'query')
}

/**
 * Generates embedding vectors for document passages (indexed chunks). Uses
 * the `passage:` role prefix required by the E5 embedding model.
 */
export async function embedPassages(
  texts: string[],
  onProgress?: EmbeddingProgressCallback,
): Promise<number[][]> {
  const worker = getEmbeddingWorker()
  return worker.generateEmbeddings(
    texts,
    'passage',
    onProgress ? proxy(onProgress) : undefined,
  )
}

export type { EmbeddingRole }
