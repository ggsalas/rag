import { expose } from 'comlink'
import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers'

export type EmbeddingModelStatus = 'idle' | 'loading' | 'ready' | 'error'

export type EmbeddingProgressCallback = (current: number, total: number) => void | Promise<void>

export interface EmbeddingWorkerAPI {
  loadModel(): Promise<void>
  getStatus(): EmbeddingModelStatus
  generateEmbedding(text: string): Promise<number[]>
  generateEmbeddings(
    texts: string[],
    onProgress?: EmbeddingProgressCallback
  ): Promise<number[][]>
}

let extractor: FeatureExtractionPipeline | null = null
let status: EmbeddingModelStatus = 'idle'

async function loadModel(): Promise<void> {
  if (status === 'ready') return
  status = 'loading'
  try {
    extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      dtype: 'fp32',
    })
    status = 'ready'
  } catch (error) {
    status = 'error'
    throw error
  }
}

function getStatus(): EmbeddingModelStatus {
  return status
}

async function generateEmbedding(text: string): Promise<number[]> {
  if (!extractor) throw new Error('Model not loaded')
  const output = await extractor(text, { pooling: 'mean', normalize: true })
  return Array.from(output.data as Float32Array)
}

async function generateEmbeddings(
  texts: string[],
  onProgress?: EmbeddingProgressCallback
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
        (output.data as Float32Array).slice(start, start + dims)
      )
      results.push(embedding)
    }
    await onProgress?.(Math.min(i + BATCH_SIZE, texts.length), texts.length)
  }
  return results
}

const api: EmbeddingWorkerAPI = { loadModel, getStatus, generateEmbedding, generateEmbeddings }
expose(api)
