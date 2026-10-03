import { wrap, type Remote } from 'comlink'
import type { ParserWorkerAPI } from '@/workers/pdf-parser.worker'
import type { EmbeddingWorkerAPI } from '@/workers/embedding.worker'
import type { RerankerWorkerAPI } from '@/workers/reranker.worker'

let parserWorker: Remote<ParserWorkerAPI> | null = null
let embeddingWorker: Remote<EmbeddingWorkerAPI> | null = null
let rerankerWorker: Remote<RerankerWorkerAPI> | null = null

/** Returns a singleton Comlink proxy for the PDF parser worker */
export function getParserWorker(): Remote<ParserWorkerAPI> {
  if (!parserWorker) {
    const worker = new Worker(
      new URL('@/workers/pdf-parser.worker.ts', import.meta.url),
      { type: 'module' },
    )
    parserWorker = wrap<ParserWorkerAPI>(worker)
  }
  return parserWorker
}

/** Returns a singleton Comlink proxy for the embedding worker */
export function getEmbeddingWorker(): Remote<EmbeddingWorkerAPI> {
  if (!embeddingWorker) {
    const worker = new Worker(
      new URL('@/workers/embedding.worker.ts', import.meta.url),
      { type: 'module' },
    )
    embeddingWorker = wrap<EmbeddingWorkerAPI>(worker)
  }
  return embeddingWorker
}

/** Returns a singleton Comlink proxy for the reranker worker */
export function getRerankerWorker(): Remote<RerankerWorkerAPI> {
  if (!rerankerWorker) {
    const worker = new Worker(
      new URL('@/workers/reranker.worker.ts', import.meta.url),
      { type: 'module' },
    )
    rerankerWorker = wrap<RerankerWorkerAPI>(worker)
  }
  return rerankerWorker
}
