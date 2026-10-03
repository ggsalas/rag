import { expose } from 'comlink'
import {
  AutoTokenizer,
  AutoModelForSequenceClassification,
  type PreTrainedModel,
  type PreTrainedTokenizer,
} from '@huggingface/transformers'
import { RERANKER_MODEL_NAME } from '@/lib/constants'

export type RerankerModelStatus = 'idle' | 'loading' | 'ready' | 'error'

/** Reports overall model-download progress as a fraction (0..1). */
export type RerankerLoadProgressCallback = (progress: number) => void

export interface RerankerWorkerAPI {
  loadModel(onProgress?: RerankerLoadProgressCallback): Promise<void>
  getStatus(): RerankerModelStatus
  /**
   * Scores a batch of (query, document) pairs. Returns one logit per pair,
   * in the same order as the input. The score is the raw logit from the
   * cross-encoder (higher = more relevant).
   */
  scorePairs(pairs: Array<[string, string]>): Promise<number[]>
}

let tokenizer: PreTrainedTokenizer | null = null
let model: PreTrainedModel | null = null
let status: RerankerModelStatus = 'idle'

/** Loads the reranker model into memory, reporting download progress (0..1). */
async function loadModel(onProgress?: RerankerLoadProgressCallback): Promise<void> {
  if (status === 'ready') return
  status = 'loading'
  // The model is fetched as several files; aggregate their byte counts so the
  // reported progress reflects the whole download, not each file in isolation.
  const files = new Map<string, { loaded: number; total: number }>()
  const progressCallback = (report: {
    status: string
    file?: string
    loaded?: number
    total?: number
  }) => {
    if (report.status !== 'progress' || !report.file || !report.total) return
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
  }

  try {
    tokenizer = await AutoTokenizer.from_pretrained(RERANKER_MODEL_NAME, {
      progress_callback: progressCallback,
    })
    model = await AutoModelForSequenceClassification.from_pretrained(RERANKER_MODEL_NAME, {
      dtype: 'q8',
      progress_callback: progressCallback,
    })
    status = 'ready'
  } catch (error) {
    status = 'error'
    throw error
  }
}

/** Returns the current status of the reranker model */
function getStatus(): RerankerModelStatus {
  return status
}

/**
 * Scores a batch of (query, document) pairs. Returns one logit per pair,
 * in the same order as the input.
 *
 * Uses AutoTokenizer + AutoModelForSequenceClassification directly to get
 * raw logits (not sigmoid probabilities). The cross-encoder returns a single
 * logit per pair (the relevance score).
 */
async function scorePairs(pairs: Array<[string, string]>): Promise<number[]> {
  if (!tokenizer || !model) throw new Error('Reranker model not loaded')
  if (pairs.length === 0) return []

  const logits: number[] = []

  // Process in batches to balance throughput and memory
  const BATCH_SIZE = 16
  for (let i = 0; i < pairs.length; i += BATCH_SIZE) {
    const batch = pairs.slice(i, i + BATCH_SIZE)
    
    // Tokenize all pairs in the batch
    const inputs = batch.map(([query, doc]) =>
      tokenizer!(query, {
        text_pair: doc,
        padding: true,
        truncation: true,
      })
    )

    // Run model on each input (batching not supported by the model directly)
    for (const input of inputs) {
      const outputs = await model!(input)
      // outputs.logits is a Tensor with shape [1, 1] for cross-encoder
      const logit = (outputs.logits.data as Float32Array)[0]!
      logits.push(logit)
    }
  }

  return logits
}

const api: RerankerWorkerAPI = {
  loadModel,
  getStatus,
  scorePairs,
}
expose(api)
