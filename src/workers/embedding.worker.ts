import { expose } from 'comlink'
import {
  pipeline,
  type FeatureExtractionPipeline,
} from '@huggingface/transformers'
import { EMBEDDING_MODEL_NAME } from '@/lib/constants'

export type EmbeddingModelStatus = 'idle' | 'loading' | 'ready' | 'error'

export type EmbeddingProgressCallback = (
  current: number,
  total: number,
) => void | Promise<void>

/** Reports overall model-download progress as a fraction (0..1). */
export type EmbeddingLoadProgressCallback = (progress: number) => void

export interface EmbeddingWorkerAPI {
  loadModel(onProgress?: EmbeddingLoadProgressCallback): Promise<void>
  getStatus(): EmbeddingModelStatus
  generateEmbedding(text: string): Promise<number[]>
  generateEmbeddings(
    texts: string[],
    onProgress?: EmbeddingProgressCallback,
  ): Promise<number[][]>
}

let extractor: FeatureExtractionPipeline | null = null
let status: EmbeddingModelStatus = 'idle'

/** Loads the embedding model into memory, reporting download progress (0..1). */
async function loadModel(
  onProgress?: EmbeddingLoadProgressCallback,
): Promise<void> {
  if (status === 'ready') return
  status = 'loading'
  // The model is fetched as several files; aggregate their byte counts so the
  // reported progress reflects the whole download, not each file in isolation.
  const files = new Map<string, { loaded: number; total: number }>()
  try {
    extractor = await pipeline('feature-extraction', EMBEDDING_MODEL_NAME, {
      dtype: 'fp32',
      progress_callback: (report: {
        status: string
        file?: string
        loaded?: number
        total?: number
      }) => {
        if (
          report.status !== 'progress' ||
          !report.file ||
          !report.total
        )
          return
        files.set(report.file, {
          loaded: report.loaded ?? 0,
          total: report.total,
        })
        let loaded = 0
        let total = 0
        for (const f of files.values()) {
          loaded += f.loaded
          total += f.total
        }
        if (total > 0) onProgress?.(loaded / total)
      },
    })
    status = 'ready'
  } catch (error) {
    status = 'error'
    throw error
  }
}

/** Returns the current status of the embedding model */
function getStatus(): EmbeddingModelStatus {
  return status
}

/** Generates an embedding vector for a single text */
async function generateEmbedding(text: string): Promise<number[]> {
  if (!extractor) throw new Error('Model not loaded')
  const output = await extractor(text, { pooling: 'mean', normalize: true })
  return Array.from(output.data as Float32Array)
}

/** Generates embedding vectors for multiple texts in batches */
async function generateEmbeddings(
  texts: string[],
  onProgress?: EmbeddingProgressCallback,
): Promise<number[][]> {
  if (!extractor) throw new Error('Model not loaded')
  const results: number[][] = []
  // Process in batches of 8 to avoid memory overflow
  const BATCH_SIZE = 8
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    const output = await extractor(batch, { pooling: 'mean', normalize: true })
    const dims = 384
    for (let j = 0; j < batch.length; j++) {
      const start = j * dims
      const embedding = Array.from(
        (output.data as Float32Array).slice(start, start + dims),
      )
      results.push(embedding)
    }
    await onProgress?.(Math.min(i + BATCH_SIZE, texts.length), texts.length)
  }
  return results
}

const api: EmbeddingWorkerAPI = {
  loadModel,
  getStatus,
  generateEmbedding,
  generateEmbeddings,
}
expose(api)
