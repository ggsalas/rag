import { expose } from 'comlink'
import {
  pipeline,
  type FeatureExtractionPipeline,
} from '@huggingface/transformers'
import {
  EMBEDDING_MODEL_NAME,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_QUERY_PREFIX,
  EMBEDDING_PASSAGE_PREFIX,
} from '@/lib/constants'

export type EmbeddingModelStatus = 'idle' | 'loading' | 'ready' | 'error'

/**
 * Whether the text being embedded is a search query or a document passage.
 * The prepended prefix depends on the model family — see EMBEDDING_QUERY_PREFIX
 * / EMBEDDING_PASSAGE_PREFIX in constants.ts. Some models (E5) require
 * `query: ` / `passage: `; others (BGE v1.5) accept plain text.
 */
export type EmbeddingRole = 'query' | 'passage'

export type EmbeddingProgressCallback = (
  current: number,
  total: number,
) => void | Promise<void>

export interface EmbeddingWorkerAPI {
  loadModel(): Promise<void>
  getStatus(): EmbeddingModelStatus
  generateEmbedding(text: string, role: EmbeddingRole): Promise<number[]>
  generateEmbeddings(
    texts: string[],
    role: EmbeddingRole,
    onProgress?: EmbeddingProgressCallback,
  ): Promise<number[][]>
}

let extractor: FeatureExtractionPipeline | null = null
let status: EmbeddingModelStatus = 'idle'

/** Prepends the model-family-specific prefix for the given role. */
function withRolePrefix(text: string, role: EmbeddingRole): string {
  const prefix =
    role === 'query' ? EMBEDDING_QUERY_PREFIX : EMBEDDING_PASSAGE_PREFIX
  return prefix ? `${prefix}${text}` : text
}

/** Loads the embedding model into memory */
async function loadModel(): Promise<void> {
  if (status === 'ready') return
  status = 'loading'
  try {
    extractor = await pipeline('feature-extraction', EMBEDDING_MODEL_NAME, {
      dtype: 'fp32',
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
async function generateEmbedding(
  text: string,
  role: EmbeddingRole,
): Promise<number[]> {
  if (!extractor) throw new Error('Model not loaded')
  const output = await extractor(withRolePrefix(text, role), {
    pooling: 'mean',
    normalize: true,
  })
  return Array.from(output.data as Float32Array)
}

/** Generates embedding vectors for multiple texts in batches */
async function generateEmbeddings(
  texts: string[],
  role: EmbeddingRole,
  onProgress?: EmbeddingProgressCallback,
): Promise<number[][]> {
  if (!extractor) throw new Error('Model not loaded')
  const results: number[][] = []
  // Process in batches of 8 to avoid memory overflow
  const BATCH_SIZE = 8
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    const prefixed = batch.map((t) => withRolePrefix(t, role))
    const output = await extractor(prefixed, {
      pooling: 'mean',
      normalize: true,
    })
    const dims = EMBEDDING_DIMENSIONS
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
